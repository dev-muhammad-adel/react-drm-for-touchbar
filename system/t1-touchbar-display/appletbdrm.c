// SPDX-License-Identifier: GPL-2.0
/*
 * Apple Touch Bar DRM Driver
 *
 * Copyright (c) 2023 Kerem Karabay <kekrby@gmail.com>
 */

#include <linux/align.h>
#include <linux/array_size.h>
#include <linux/bitops.h>
#include <linux/bug.h>
#include <linux/container_of.h>
#include <linux/err.h>
#include <linux/module.h>
#include <linux/overflow.h>
#include <linux/slab.h>
#include <linux/types.h>
#include <linux/unaligned.h>
#include <linux/usb.h>

#include <drm/drm_atomic.h>
#include <drm/drm_atomic_helper.h>
#include <drm/drm_crtc.h>
#include <drm/drm_damage_helper.h>
#include <drm/drm_drv.h>
#include <drm/drm_encoder.h>
#include <drm/drm_format_helper.h>
#include <drm/drm_fourcc.h>
#include <drm/drm_framebuffer.h>
#include <drm/drm_gem_atomic_helper.h>
#include <drm/drm_gem_framebuffer_helper.h>
#include <drm/drm_gem_shmem_helper.h>
#include <drm/drm_modeset_helper.h>
#include <drm/drm_plane.h>
#include <drm/drm_print.h>
#include <drm/drm_probe_helper.h>

#define APPLETBDRM_PIXEL_FORMAT		cpu_to_le32(0x52474241) /* RGBA, the actual format is BGR888 */
#define APPLETBDRM_BITS_PER_PIXEL	24

#define APPLETBDRM_MSG_CLEAR_DISPLAY	cpu_to_le32(0x434c5244) /* CLRD */
#define APPLETBDRM_MSG_GET_INFORMATION	cpu_to_le32(0x47494e46) /* GINF */
#define APPLETBDRM_MSG_UPDATE_COMPLETE	cpu_to_le32(0x5544434c) /* UDCL */
#define APPLETBDRM_MSG_SIGNAL_READINESS	cpu_to_le32(0x52454459) /* REDY */

#define APPLETBDRM_BULK_MSG_TIMEOUT	1000

#define drm_to_adev(_drm)		container_of(_drm, struct appletbdrm_device, drm)
#define adev_to_udev(adev)		interface_to_usbdev(to_usb_interface((adev)->drm.dev))

struct appletbdrm_msg_request_header {
	__le16 unk_00;
	__le16 unk_02;
	__le32 unk_04;
	__le32 unk_08;
	__le32 size;
} __packed;

struct appletbdrm_msg_response_header {
	u8 unk_00[16];
	__le32 msg;
} __packed;

struct appletbdrm_msg_simple_request {
	struct appletbdrm_msg_request_header header;
	__le32 msg;
	u8 unk_14[8];
	__le32 size;
} __packed;

struct appletbdrm_msg_information {
	struct appletbdrm_msg_response_header header;
	u8 unk_14[12];
	__le32 width;
	__le32 height;
	u8 bits_per_pixel;
	__le32 bytes_per_row;
	__le32 orientation;
	__le32 bitmap_info;
	__le32 pixel_format;
	__le32 width_inches;	/* floating point */
	__le32 height_inches;	/* floating point */
} __packed;

struct appletbdrm_frame {
	__le16 begin_x;
	__le16 begin_y;
	__le16 width;
	__le16 height;
	__le32 buf_size;
	u8 buf[];
} __packed;

struct appletbdrm_fb_request_footer {
	u8 unk_00[12];
	__le32 unk_0c;
	u8 unk_10[12];
	__le32 unk_1c;
	__le64 timestamp;
	u8 unk_28[12];
	__le32 unk_34;
	u8 unk_38[20];
	__le32 unk_4c;
} __packed;

struct appletbdrm_fb_request {
	struct appletbdrm_msg_request_header header;
	__le16 unk_10;
	u8 msg_id;
	u8 unk_13[29];
	/*
	 * Contents of `data`:
	 * - struct appletbdrm_frame frames[];
	 * - struct appletbdrm_fb_request_footer footer;
	 * - padding to make the total size a multiple of 16
	 */
	u8 data[];
} __packed;

struct appletbdrm_fb_request_response {
	struct appletbdrm_msg_response_header header;
	u8 unk_14[12];
	__le64 timestamp;
} __packed;

struct appletbdrm_device {
	unsigned int in_ep;
	unsigned int out_ep;

	unsigned int width;
	unsigned int height;

	struct drm_device drm;
	struct drm_display_mode mode;
	struct drm_connector connector;
	struct drm_plane primary_plane;
	struct drm_crtc crtc;
	struct drm_encoder encoder;
};

struct appletbdrm_plane_state {
	struct drm_shadow_plane_state base;
	struct appletbdrm_fb_request *request;
	struct appletbdrm_fb_request_response *response;
	size_t request_size;
	size_t frames_size;
};

static inline struct appletbdrm_plane_state *to_appletbdrm_plane_state(struct drm_plane_state *state)
{
	return container_of(state, struct appletbdrm_plane_state, base.base);
}

static int appletbdrm_send_request(struct appletbdrm_device *adev,
				   struct appletbdrm_msg_request_header *request, size_t size)
{
	struct usb_device *udev = adev_to_udev(adev);
	struct drm_device *drm = &adev->drm;
	int ret, actual_size;

	ret = usb_bulk_msg(udev, usb_sndbulkpipe(udev, adev->out_ep),
			   request, size, &actual_size, APPLETBDRM_BULK_MSG_TIMEOUT);
	if (ret) {
		drm_err(drm, "Failed to send message (%d)\n", ret);
		return ret;
	}

	if (actual_size != size) {
		drm_err(drm, "Actual size (%d) doesn't match expected size (%zu)\n",
			actual_size, size);
		return -EIO;
	}

	return 0;
}

static int appletbdrm_read_response(struct appletbdrm_device *adev,
				    struct appletbdrm_msg_response_header *response,
				    size_t size, __le32 expected_response)
{
	struct usb_device *udev = adev_to_udev(adev);
	struct drm_device *drm = &adev->drm;
	int ret, actual_size, attempts = 0;

retry:
	ret = usb_bulk_msg(udev, usb_rcvbulkpipe(udev, adev->in_ep),
			   response, size, &actual_size, APPLETBDRM_BULK_MSG_TIMEOUT);
	if (ret) {
		drm_err(drm, "Failed to read response (%d)\n", ret);
		return ret;
	}

	/*
	 * Right after the config switch the T1 firmware emits transient messages
	 * before the real reply -- a readiness signal (REDY) and a short status
	 * message (observed 52 bytes on the GINF read). Treat anything that isn't
	 * the expected, full-size response as transient, drain it and re-read, up
	 * to a small bound.
	 */
	if (actual_size != size || response->msg != expected_response) {
		if (++attempts < 8)
			goto retry;
		drm_err(drm, "No valid response after draining (last size %d, msg %p4cl, expected %p4cl)\n",
			actual_size, &response->msg, &expected_response);
		return -EBADMSG;
	}

	return 0;
}

static int appletbdrm_send_msg(struct appletbdrm_device *adev, __le32 msg)
{
	struct appletbdrm_msg_simple_request *request;
	int ret;

	request = kzalloc_obj(*request);
	if (!request)
		return -ENOMEM;

	request->header.unk_00 = cpu_to_le16(2);
	request->header.unk_02 = cpu_to_le16(0x1512);
	request->header.size = cpu_to_le32(sizeof(*request) - sizeof(request->header));
	request->msg = msg;
	request->size = request->header.size;

	ret = appletbdrm_send_request(adev, &request->header, sizeof(*request));

	kfree(request);

	return ret;
}

static int __maybe_unused appletbdrm_clear_display(struct appletbdrm_device *adev)
{
	return appletbdrm_send_msg(adev, APPLETBDRM_MSG_CLEAR_DISPLAY);
}

static int appletbdrm_signal_readiness(struct appletbdrm_device *adev)
{
	return appletbdrm_send_msg(adev, APPLETBDRM_MSG_SIGNAL_READINESS);
}

static int appletbdrm_get_information(struct appletbdrm_device *adev)
{
	struct appletbdrm_msg_information *info;
	struct drm_device *drm = &adev->drm;
	u8 bits_per_pixel;
	__le32 pixel_format;
	int ret;

	info = kzalloc_obj(*info);
	if (!info)
		return -ENOMEM;

	ret = appletbdrm_send_msg(adev, APPLETBDRM_MSG_GET_INFORMATION);
	if (ret)
		return ret;

	ret = appletbdrm_read_response(adev, &info->header, sizeof(*info),
				       APPLETBDRM_MSG_GET_INFORMATION);
	if (ret)
		goto free_info;

	bits_per_pixel = info->bits_per_pixel;
	pixel_format = get_unaligned(&info->pixel_format);

	adev->width = get_unaligned_le32(&info->width);
	adev->height = get_unaligned_le32(&info->height);

	if (bits_per_pixel != APPLETBDRM_BITS_PER_PIXEL) {
		drm_err(drm, "Encountered unexpected bits per pixel value (%d)\n", bits_per_pixel);
		ret = -EINVAL;
		goto free_info;
	}

	if (pixel_format != APPLETBDRM_PIXEL_FORMAT) {
		drm_err(drm, "Encountered unknown pixel format (%p4cl)\n", &pixel_format);
		ret = -EINVAL;
		goto free_info;
	}

free_info:
	kfree(info);

	return ret;
}

static u32 rect_size(struct drm_rect *rect)
{
	return drm_rect_width(rect) * drm_rect_height(rect) *
		(BITS_TO_BYTES(APPLETBDRM_BITS_PER_PIXEL));
}

static int appletbdrm_connector_helper_get_modes(struct drm_connector *connector)
{
	struct appletbdrm_device *adev = drm_to_adev(connector->dev);

	return drm_connector_helper_get_modes_fixed(connector, &adev->mode);
}

static const u32 appletbdrm_primary_plane_formats[] = {
	DRM_FORMAT_RGB888,   /* T1 panel byte order is R,G,B (T2 is BGR) */
	DRM_FORMAT_XRGB8888, /* emulated */
};

static int appletbdrm_primary_plane_helper_atomic_check(struct drm_plane *plane,
						   struct drm_atomic_state *state)
{
	struct drm_plane_state *new_plane_state = drm_atomic_get_new_plane_state(state, plane);
	struct drm_plane_state *old_plane_state = drm_atomic_get_old_plane_state(state, plane);
	struct drm_crtc *new_crtc = new_plane_state->crtc;
	struct drm_crtc_state *new_crtc_state = NULL;
	struct appletbdrm_plane_state *appletbdrm_state = to_appletbdrm_plane_state(new_plane_state);
	struct drm_atomic_helper_damage_iter iter;
	struct drm_rect damage;
	size_t frames_size = 0;
	size_t request_size;
	int ret;

	if (new_crtc)
		new_crtc_state = drm_atomic_get_new_crtc_state(state, new_crtc);

	ret = drm_atomic_helper_check_plane_state(new_plane_state, new_crtc_state,
						  DRM_PLANE_NO_SCALING,
						  DRM_PLANE_NO_SCALING,
						  false, false);
	if (ret)
		return ret;
	else if (!new_plane_state->visible)
		return 0;

	drm_atomic_helper_damage_iter_init(&iter, old_plane_state, new_plane_state);
	drm_atomic_for_each_plane_damage(&iter, &damage) {
		frames_size += struct_size((struct appletbdrm_frame *)0, buf, rect_size(&damage));
	}

	if (!frames_size)
		return 0;

	request_size = ALIGN(sizeof(struct appletbdrm_fb_request) +
		       frames_size +
		       sizeof(struct appletbdrm_fb_request_footer), 16);

	appletbdrm_state->request = kvzalloc(request_size, GFP_KERNEL);

	if (!appletbdrm_state->request)
		return -ENOMEM;

	appletbdrm_state->response = kzalloc_obj(*appletbdrm_state->response);

	if (!appletbdrm_state->response)
		return -ENOMEM;

	appletbdrm_state->request_size = request_size;
	appletbdrm_state->frames_size = frames_size;

	return 0;
}

static int appletbdrm_flush_damage(struct appletbdrm_device *adev,
				   struct drm_plane_state *old_state,
				   struct drm_plane_state *state)
{
	struct appletbdrm_plane_state *appletbdrm_state = to_appletbdrm_plane_state(state);
	struct drm_shadow_plane_state *shadow_plane_state = to_drm_shadow_plane_state(state);
	struct appletbdrm_fb_request_response *response = appletbdrm_state->response;
	struct appletbdrm_fb_request_footer *footer;
	struct drm_atomic_helper_damage_iter iter;
	struct drm_framebuffer *fb = state->fb;
	struct appletbdrm_fb_request *request = appletbdrm_state->request;
	struct drm_device *drm = &adev->drm;
	struct appletbdrm_frame *frame;
	u64 timestamp = ktime_get_ns();
	struct drm_rect damage;
	size_t frames_size = appletbdrm_state->frames_size;
	size_t request_size = appletbdrm_state->request_size;
	int ret;

	if (!frames_size)
		return 0;

	ret = drm_gem_fb_begin_cpu_access(fb, DMA_FROM_DEVICE);
	if (ret) {
		drm_err(drm, "Failed to start CPU framebuffer access (%d)\n", ret);
		goto end_fb_cpu_access;
	}

	request->header.unk_00 = cpu_to_le16(2);
	request->header.unk_02 = cpu_to_le16(0x12);
	request->header.unk_04 = cpu_to_le32(9);
	request->header.size = cpu_to_le32(request_size - sizeof(request->header));
	request->unk_10 = cpu_to_le16(1);
	request->msg_id = timestamp;

	frame = (struct appletbdrm_frame *)request->data;

	drm_atomic_helper_damage_iter_init(&iter, old_state, state);
	drm_atomic_for_each_plane_damage(&iter, &damage) {
		struct drm_rect dst_clip = state->dst;
		struct iosys_map dst = IOSYS_MAP_INIT_VADDR(frame->buf);
		u32 buf_size = rect_size(&damage);

		if (!drm_rect_intersect(&dst_clip, &damage))
			continue;

		/*
		 * The coordinates need to be translated to the coordinate
		 * system the device expects, see the comment in
		 * appletbdrm_setup_mode_config
		 */
		frame->begin_x = cpu_to_le16(damage.y1);
		frame->begin_y = cpu_to_le16(adev->height - damage.x2);
		frame->width = cpu_to_le16(drm_rect_height(&damage));
		frame->height = cpu_to_le16(drm_rect_width(&damage));
		frame->buf_size = cpu_to_le32(buf_size);

		switch (fb->format->format) {
		case DRM_FORMAT_XRGB8888:
			drm_fb_xrgb8888_to_rgb888(&dst, NULL, &shadow_plane_state->data[0], fb, &damage, &shadow_plane_state->fmtcnv_state);
			break;
		default:
			drm_fb_memcpy(&dst, NULL, &shadow_plane_state->data[0], fb, &damage);
			break;
		}

		frame = (void *)frame + struct_size(frame, buf, buf_size);
	}

	footer = (struct appletbdrm_fb_request_footer *)&request->data[frames_size];

	footer->unk_0c = cpu_to_le32(0xfffe);
	footer->unk_1c = cpu_to_le32(0x80001);
	footer->unk_34 = cpu_to_le32(0x80002);
	footer->unk_4c = cpu_to_le32(0xffff);
	footer->timestamp = cpu_to_le64(timestamp);

	ret = appletbdrm_send_request(adev, &request->header, request_size);
	if (ret)
		goto end_fb_cpu_access;

	/*
	 * Every T1 request produces a 16-byte request-header echo followed by
	 * the real 40-byte UDCL response. Reading just one message leaves the
	 * other queued; after a few frames the IN endpoint backpressures OUT
	 * and every frame stalls for the one-second bulk timeout. The response
	 * helper drains the short echo and returns only the complete UDCL.
	 * T1 may acknowledge the previous frame, so its timestamp is not a
	 * reliable request identifier.
	 */
	ret = appletbdrm_read_response(adev, &response->header, sizeof(*response),
				       APPLETBDRM_MSG_UPDATE_COMPLETE);
	if (ret)
		goto end_fb_cpu_access;

	if (le16_to_cpu(adev_to_udev(adev)->descriptor.idProduct) != 0x8600 &&
	    response->timestamp != footer->timestamp) {
		drm_err(drm, "Response timestamp (%llu) doesn't match request timestamp (%llu)\n",
			le64_to_cpu(response->timestamp), timestamp);
		ret = -EBADMSG;
		goto end_fb_cpu_access;
	}

end_fb_cpu_access:
	drm_gem_fb_end_cpu_access(fb, DMA_FROM_DEVICE);

	return ret;
}

static void appletbdrm_primary_plane_helper_atomic_update(struct drm_plane *plane,
						     struct drm_atomic_state *old_state)
{
	struct appletbdrm_device *adev = drm_to_adev(plane->dev);
	struct drm_device *drm = plane->dev;
	struct drm_plane_state *plane_state = plane->state;
	struct drm_plane_state *old_plane_state = drm_atomic_get_old_plane_state(old_state, plane);
	int idx;

	if (!drm_dev_enter(drm, &idx))
		return;

	/*
	 * T1 (14,3): CLEAR_DISPLAY (sent by .atomic_disable on client
	 * teardown) parks the display pipeline — later frames are still
	 * ACKed but no longer rendered. Re-arm on every fresh plane enable:
	 * reset the bulk pipes and re-send REDY before the first frame.
	 */
	if (!old_plane_state->fb && plane_state->fb) {
		struct usb_device *udev = adev_to_udev(adev);
		int r1 = usb_clear_halt(udev, usb_sndbulkpipe(udev, adev->out_ep));
		int r2 = usb_clear_halt(udev, usb_rcvbulkpipe(udev, adev->in_ep));
		int r3 = appletbdrm_signal_readiness(adev);
		dev_info(drm->dev, "tbx: fresh modeset — re-arm REDY (%d/%d/%d)\n",
			 r1, r2, r3);
	}

	appletbdrm_flush_damage(adev, old_plane_state, plane_state);

	drm_dev_exit(idx);
}

static void appletbdrm_primary_plane_helper_atomic_disable(struct drm_plane *plane,
							   struct drm_atomic_state *state)
{
	struct drm_device *dev = plane->dev;
	int idx;

	if (!drm_dev_enter(dev, &idx))
		return;

	/*
	 * T1 (14,3): deliberately NO clear_display() here. A CLEAR_DISPLAY
	 * (DRLC) parks the display pipeline for the rest of the session —
	 * later frames are ACKed but not rendered, and no known re-arm
	 * (REDY, GINF+REDY, pipe reset) revives it; only a fresh config
	 * transition or reboot does. Leaving the last frame on the bar
	 * across renderer restarts is the lesser evil.
	 */

	drm_dev_exit(idx);
}

static void appletbdrm_primary_plane_destroy_state(struct drm_plane *plane,
						   struct drm_plane_state *state);

static void appletbdrm_primary_plane_reset(struct drm_plane *plane)
{
	struct appletbdrm_plane_state *appletbdrm_state;

	/*
	 * .reset must be re-entrant: drm_atomic_helper_resume() (driven from our
	 * USB .resume/.reset_resume) calls drm_mode_config_reset(), which
	 * re-invokes this hook while a plane state already exists. Tear the old
	 * state down first instead of WARNing and leaking it (the original
	 * upstream code assumed reset only ran once, at probe).
	 */
	if (plane->state) {
		appletbdrm_primary_plane_destroy_state(plane, plane->state);
		plane->state = NULL;
	}

	appletbdrm_state = kzalloc_obj(*appletbdrm_state);
	if (!appletbdrm_state)
		return;

	__drm_gem_reset_shadow_plane(plane, &appletbdrm_state->base);
}

static struct drm_plane_state *appletbdrm_primary_plane_duplicate_state(struct drm_plane *plane)
{
	struct drm_shadow_plane_state *new_shadow_plane_state;
	struct appletbdrm_plane_state *appletbdrm_state;

	if (WARN_ON(!plane->state))
		return NULL;

	appletbdrm_state = kzalloc_obj(*appletbdrm_state);
	if (!appletbdrm_state)
		return NULL;

	/* Request and response are not duplicated and are allocated in .atomic_check */
	appletbdrm_state->request = NULL;
	appletbdrm_state->response = NULL;

	appletbdrm_state->request_size = 0;
	appletbdrm_state->frames_size = 0;

	new_shadow_plane_state = &appletbdrm_state->base;

	__drm_gem_duplicate_shadow_plane_state(plane, new_shadow_plane_state);

	return &new_shadow_plane_state->base;
}

static void appletbdrm_primary_plane_destroy_state(struct drm_plane *plane,
						   struct drm_plane_state *state)
{
	struct appletbdrm_plane_state *appletbdrm_state = to_appletbdrm_plane_state(state);

	kvfree(appletbdrm_state->request);
	kfree(appletbdrm_state->response);

	__drm_gem_destroy_shadow_plane_state(&appletbdrm_state->base);

	kfree(appletbdrm_state);
}

static const struct drm_plane_helper_funcs appletbdrm_primary_plane_helper_funcs = {
	DRM_GEM_SHADOW_PLANE_HELPER_FUNCS,
	.atomic_check = appletbdrm_primary_plane_helper_atomic_check,
	.atomic_update = appletbdrm_primary_plane_helper_atomic_update,
	.atomic_disable = appletbdrm_primary_plane_helper_atomic_disable,
};

static const struct drm_plane_funcs appletbdrm_primary_plane_funcs = {
	.update_plane = drm_atomic_helper_update_plane,
	.disable_plane = drm_atomic_helper_disable_plane,
	.reset = appletbdrm_primary_plane_reset,
	.atomic_duplicate_state = appletbdrm_primary_plane_duplicate_state,
	.atomic_destroy_state = appletbdrm_primary_plane_destroy_state,
	.destroy = drm_plane_cleanup,
};

static enum drm_mode_status appletbdrm_crtc_helper_mode_valid(struct drm_crtc *crtc,
							  const struct drm_display_mode *mode)
{
	struct appletbdrm_device *adev = drm_to_adev(crtc->dev);

	return drm_crtc_helper_mode_valid_fixed(crtc, mode, &adev->mode);
}

static const struct drm_mode_config_funcs appletbdrm_mode_config_funcs = {
	.fb_create = drm_gem_fb_create_with_dirty,
	.atomic_check = drm_atomic_helper_check,
	.atomic_commit = drm_atomic_helper_commit,
};

static const struct drm_connector_funcs appletbdrm_connector_funcs = {
	.reset = drm_atomic_helper_connector_reset,
	.destroy = drm_connector_cleanup,
	.fill_modes = drm_helper_probe_single_connector_modes,
	.atomic_destroy_state = drm_atomic_helper_connector_destroy_state,
	.atomic_duplicate_state = drm_atomic_helper_connector_duplicate_state,
};

static const struct drm_connector_helper_funcs appletbdrm_connector_helper_funcs = {
	.get_modes = appletbdrm_connector_helper_get_modes,
};

static const struct drm_crtc_helper_funcs appletbdrm_crtc_helper_funcs = {
	.mode_valid = appletbdrm_crtc_helper_mode_valid,
};

static const struct drm_crtc_funcs appletbdrm_crtc_funcs = {
	.reset = drm_atomic_helper_crtc_reset,
	.destroy = drm_crtc_cleanup,
	.set_config = drm_atomic_helper_set_config,
	.page_flip = drm_atomic_helper_page_flip,
	.atomic_duplicate_state = drm_atomic_helper_crtc_duplicate_state,
	.atomic_destroy_state = drm_atomic_helper_crtc_destroy_state,
};

static const struct drm_encoder_funcs appletbdrm_encoder_funcs = {
	.destroy = drm_encoder_cleanup,
};

DEFINE_DRM_GEM_FOPS(appletbdrm_drm_fops);

static const struct drm_driver appletbdrm_drm_driver = {
	DRM_GEM_SHMEM_DRIVER_OPS,
	.name			= "appletbdrm",
	.desc			= "Apple Touch Bar DRM Driver",
	.major			= 1,
	.minor			= 0,
	.driver_features	= DRIVER_MODESET | DRIVER_GEM | DRIVER_ATOMIC,
	.fops			= &appletbdrm_drm_fops,
};

static int appletbdrm_setup_mode_config(struct appletbdrm_device *adev)
{
	struct drm_connector *connector = &adev->connector;
	struct drm_plane *primary_plane;
	struct drm_crtc *crtc;
	struct drm_encoder *encoder;
	struct drm_device *drm = &adev->drm;
	int ret;

	ret = drmm_mode_config_init(drm);
	if (ret) {
		drm_err(drm, "Failed to initialize mode configuration\n");
		return ret;
	}

	primary_plane = &adev->primary_plane;
	ret = drm_universal_plane_init(drm, primary_plane, 0,
				       &appletbdrm_primary_plane_funcs,
				       appletbdrm_primary_plane_formats,
				       ARRAY_SIZE(appletbdrm_primary_plane_formats),
				       NULL,
				       DRM_PLANE_TYPE_PRIMARY, NULL);
	if (ret) {
		drm_err(drm, "Failed to initialize universal plane object\n");
		return ret;
	}

	drm_plane_helper_add(primary_plane, &appletbdrm_primary_plane_helper_funcs);
	drm_plane_enable_fb_damage_clips(primary_plane);

	crtc = &adev->crtc;
	ret = drm_crtc_init_with_planes(drm, crtc, primary_plane, NULL,
					&appletbdrm_crtc_funcs, NULL);
	if (ret) {
		drm_err(drm, "Failed to initialize CRTC object\n");
		return ret;
	}

	drm_crtc_helper_add(crtc, &appletbdrm_crtc_helper_funcs);

	encoder = &adev->encoder;
	ret = drm_encoder_init(drm, encoder, &appletbdrm_encoder_funcs,
			       DRM_MODE_ENCODER_DAC, NULL);
	if (ret) {
		drm_err(drm, "Failed to initialize encoder\n");
		return ret;
	}

	encoder->possible_crtcs = drm_crtc_mask(crtc);

	/*
	 * The coordinate system used by the device is different from the
	 * coordinate system of the framebuffer in that the x and y axes are
	 * swapped, and that the y axis is inverted; so what the device reports
	 * as the height is actually the width of the framebuffer and vice
	 * versa.
	 */
	drm->mode_config.max_width = max(adev->height, DRM_SHADOW_PLANE_MAX_WIDTH);
	drm->mode_config.max_height = max(adev->width, DRM_SHADOW_PLANE_MAX_HEIGHT);
	drm->mode_config.preferred_depth = APPLETBDRM_BITS_PER_PIXEL;
	drm->mode_config.funcs = &appletbdrm_mode_config_funcs;

	adev->mode = (struct drm_display_mode) {
		DRM_MODE_INIT(60, adev->height, adev->width,
			      DRM_MODE_RES_MM(adev->height, 218),
			      DRM_MODE_RES_MM(adev->width, 218))
	};

	ret = drm_connector_init(drm, connector,
				 &appletbdrm_connector_funcs, DRM_MODE_CONNECTOR_USB);
	if (ret) {
		drm_err(drm, "Failed to initialize connector\n");
		return ret;
	}

	drm_connector_helper_add(connector, &appletbdrm_connector_helper_funcs);

	ret = drm_connector_set_panel_orientation(connector,
						  DRM_MODE_PANEL_ORIENTATION_RIGHT_UP);
	if (ret) {
		drm_err(drm, "Failed to set panel orientation\n");
		return ret;
	}

	connector->display_info.non_desktop = true;
	ret = drm_object_property_set_value(&connector->base,
					    drm->mode_config.non_desktop_property, true);
	if (ret) {
		drm_err(drm, "Failed to set non-desktop property\n");
		return ret;
	}

	ret = drm_connector_attach_encoder(connector, encoder);

	if (ret) {
		drm_err(drm, "Failed to initialize simple display pipe\n");
		return ret;
	}

	drm_mode_config_reset(drm);

	return 0;
}

static int appletbdrm_probe(struct usb_interface *intf,
			    const struct usb_device_id *id)
{
	struct usb_endpoint_descriptor *bulk_in, *bulk_out;
	struct device *dev = &intf->dev;
	struct appletbdrm_device *adev;
	struct drm_device *drm = NULL;
	struct device *dma_dev;
	int ret;

	ret = usb_find_common_endpoints(intf->cur_altsetting, &bulk_in, &bulk_out, NULL, NULL);
	if (ret) {
		drm_err(drm, "appletbdrm: Failed to find bulk endpoints\n");
		return ret;
	}

	adev = devm_drm_dev_alloc(dev, &appletbdrm_drm_driver, struct appletbdrm_device, drm);
	if (IS_ERR(adev))
		return PTR_ERR(adev);

	adev->in_ep = bulk_in->bEndpointAddress;
	adev->out_ep = bulk_out->bEndpointAddress;

	drm = &adev->drm;

	usb_set_intfdata(intf, adev);

	dma_dev = usb_intf_get_dma_device(intf);
	if (dma_dev) {
		drm_dev_set_dma_dev(drm, dma_dev);
		put_device(dma_dev);
	} else {
		drm_warn(drm, "buffer sharing not supported"); /* not an error */
	}

	/*
	 * Mirror the proven userspace bring-up (and the Windows DFRDisplayKm): reset
	 * the bulk pipes after the config switch so a stale/transient post-switch
	 * message (T1 emits a short ~52-byte status before the GINF reply) doesn't
	 * desync the first read.
	 */
	usb_clear_halt(adev_to_udev(adev), usb_sndbulkpipe(adev_to_udev(adev), adev->out_ep));
	usb_clear_halt(adev_to_udev(adev), usb_rcvbulkpipe(adev_to_udev(adev), adev->in_ep));

	ret = appletbdrm_get_information(adev);
	if (ret) {
		drm_err(drm, "Failed to get display information\n");
		return ret;
	}

	ret = appletbdrm_signal_readiness(adev);
	if (ret) {
		drm_err(drm, "Failed to signal readiness\n");
		return ret;
	}

	ret = appletbdrm_setup_mode_config(adev);
	if (ret) {
		drm_err(drm, "Failed to setup mode config\n");
		return ret;
	}

	ret = drm_dev_register(drm, 0);
	if (ret) {
		drm_err(drm, "Failed to register DRM device\n");
		return ret;
	}

	/*
	 * T1 (14,3): do NOT clear the display here. A CLEAR_DISPLAY (DRLC)
	 * between REDY and the first userspace frame parks the display
	 * pipeline — frames are still ACKed but no longer rendered (the
	 * libusb spike proves the panel lights when nothing intervenes).
	 */

	return 0;
}

static void appletbdrm_disconnect(struct usb_interface *intf)
{
	struct appletbdrm_device *adev = usb_get_intfdata(intf);
	struct drm_device *drm = &adev->drm;

	drm_dev_unplug(drm);
	drm_atomic_helper_shutdown(drm);
}

static void appletbdrm_shutdown(struct usb_interface *intf)
{
	struct appletbdrm_device *adev = usb_get_intfdata(intf);

	/* The T1 disable hook deliberately keeps the last frame; no CLRD. */
	drm_atomic_helper_shutdown(&adev->drm);
}

/*
 * Re-arm the T1 display pipeline after a system sleep: reset both bulk
 * pipes, repeat GINF+REDY, then let the DRM resume helper upload a full
 * framebuffer. Do not send CLEAR_DISPLAY; on the 14,3 it parks the engine.
 */
static int appletbdrm_rearm_display(struct appletbdrm_device *adev)
{
	struct usb_device *udev = adev_to_udev(adev);
	int ret;

	usb_clear_halt(udev, usb_sndbulkpipe(udev, adev->out_ep));
	usb_clear_halt(udev, usb_rcvbulkpipe(udev, adev->in_ep));

	ret = appletbdrm_get_information(adev);
	if (ret)
		return ret;

	ret = appletbdrm_signal_readiness(adev);
	if (ret)
		return ret;

	/*
	 * T1 (14,3): NO clear_display() here. Empirically every
	 * CLEAR_DISPLAY (DRLC) — probe, disable, suspend, resume —
	 * parks the display pipeline: subsequent frame pushes either
	 * render nothing or time out (-110). The wake sequence that
	 * reliably works is simply: reset pipes, GINF, REDY, then let
	 * the DRM resume helper re-upload the framebuffer.
	 */
	return 0;
}

/*
 * T1 (14,3): deliberately do NOT park the panel on suspend.
 * The macOS-style park sequence (CLEAR_DISPLAY x2 + SET_REPORT id 3)
 * strands the display engine: after wake, frame pushes render nothing
 * or time out (-110), and no known message revives it. Across s2idle
 * the bridge stays powered and the engine survives untouched — so the
 * safest pre-sleep action is none at all.
 */
static void appletbdrm_park_display(struct appletbdrm_device *adev)
{
	(void)adev;
}

static int appletbdrm_suspend(struct usb_interface *intf, pm_message_t message)
{
	struct appletbdrm_device *adev = usb_get_intfdata(intf);

	int ret;

	/*
	 * Save the modeset state and disable the plane (.atomic_disable is a
	 * no-op on the T1 — never CLEAR_DISPLAY). No pre-sleep park either:
	 * parking strands the engine past wake (see appletbdrm_park_display).
	 */
	ret = drm_mode_config_helper_suspend(&adev->drm);
	appletbdrm_park_display(adev);

	return ret;
}

static int appletbdrm_resume(struct usb_interface *intf)
{
	struct appletbdrm_device *adev = usb_get_intfdata(intf);
	struct drm_device *drm = &adev->drm;
	int ret;

	ret = appletbdrm_rearm_display(adev);
	if (ret)
		drm_err(drm, "Failed to re-arm display on resume (%d)\n", ret);
	else
		drm_info(drm, "re-armed display on resume (GINF+REDY ok), recommitting framebuffer\n");

	/* Re-commit the saved mode -> full framebuffer re-upload. */
	ret = drm_mode_config_helper_resume(drm);
	drm_info(drm, "resume framebuffer recommit returned %d\n", ret);

	return ret;
}

static const struct usb_device_id appletbdrm_usb_id_table[] = {
	{ USB_DEVICE_INTERFACE_CLASS(0x05ac, 0x8302, USB_CLASS_AUDIO_VIDEO) },
	/* Apple T1 iBridge (MacBookPro13,x / 14,x): the AV interface only
	 * exists in the display-mode configuration selected at enumeration
	 * by apple_dfr_cfgsel. */
	{ USB_DEVICE_INTERFACE_CLASS(0x05ac, 0x8600, USB_CLASS_AUDIO_VIDEO) },
	{}
};
MODULE_DEVICE_TABLE(usb, appletbdrm_usb_id_table);

static struct usb_driver appletbdrm_usb_driver = {
	.name		= "appletbdrm",
	.probe		= appletbdrm_probe,
	.disconnect	= appletbdrm_disconnect,
	.shutdown	= appletbdrm_shutdown,
	/*
	 * .resume runs on S3 wake; .reset_resume runs when the device was reset
	 * during resume (the usual S4/hibernate case). Both re-arm the parked
	 * display pipeline -- see appletbdrm_rearm_display().
	 */
	.suspend	= appletbdrm_suspend,
	.resume		= appletbdrm_resume,
	.reset_resume	= appletbdrm_resume,
	.id_table	= appletbdrm_usb_id_table,
};
module_usb_driver(appletbdrm_usb_driver);

MODULE_AUTHOR("Kerem Karabay <kekrby@gmail.com>");
MODULE_DESCRIPTION("Apple Touch Bar DRM Driver");
MODULE_LICENSE("GPL");
