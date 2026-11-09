// SPDX-License-Identifier: GPL-2.0
/*
 * apple_dfr_cfgsel — enumeration-time configuration selector for the
 * Apple T1 iBridge (05ac:8600) so the Touch Bar comes up in "display mode".
 *
 * Background
 * ----------
 * The T1 iBridge is a composite USB device with 3 configurations:
 *   config 1: camera + 2 HID interfaces        -> firmware "simple mode"
 *   config 2: camera + HID + CDC-NCM + AV(0x10) -> macOS "display mode"
 *             (interface 3, class 0x10, bulk OUT 0x02 / bulk IN 0x85 —
 *              the appletbdrm pixel-streaming interface)
 *   config 3: like 1 + CDC-NCM
 *
 * The kernel's default policy (usb_choose_configuration() in
 * drivers/usb/core/generic.c) picks config 1 (first config whose first
 * interface is non-vendor-specific).  Runtime switches to config 2 from
 * userspace don't stick: the out-of-tree apple_ibridge HID driver forces
 * the device back to config 1 from its probe (usb_driver_set_configuration),
 * and the firmware itself can self-reset on a live 1->2 switch, after which
 * re-enumeration lands on config 1 again.
 *
 * The robust fix — mirroring what Windows' usbccgp does with
 * OriginalConfigurationValue in imbushuo/DFRDisplayKm — is to make the
 * *kernel's own* configuration choice be the display config, at enumeration
 * time, every time.  Since v6.8 the supported mechanism for this is a
 * usb_device_driver with a .choose_configuration callback and
 * .generic_subclass = 1 (see rtl8152_cfgselector_driver in
 * drivers/net/usb/r8152.c).  Because this driver has an id_table, it
 * preempts usb_generic_driver at match time (usb_generic_driver_match() ->
 * __check_for_non_generic_match()), and usb_choose_configuration() defers
 * to our callback.  usb_register_device_driver() automatically reprobes a
 * device already bound to the generic driver, so loading this module is
 * enough to trigger the switch on an already-enumerated device.
 *
 * With the device-level policy fixed, udev->actconfig is the display
 * config, so even usb_reset_device()/reset-resume restores config 2
 * (usb_reset_and_verify_device() restores actconfig), and any firmware
 * self-reset re-enumerates straight into display mode.
 *
 * Copyright (c) 2026
 */

#include <linux/module.h>
#include <linux/usb.h>

#define APPLE_VID		0x05ac
#define IBRIDGE_T1_PID		0x8600

static int display_config = -1;
module_param(display_config, int, 0644);
MODULE_PARM_DESC(display_config,
		 "bConfigurationValue to force (-1 = auto: first config exposing an Audio/Video class interface; 0 = disabled, fall back to kernel default)");

static int appledfr_choose_configuration(struct usb_device *udev)
{
	struct usb_host_config *c;
	int num_configs;
	int i, j;

	if (display_config == 0)
		return -ENODEV;	/* defer to usb_choose_configuration() */

	if (display_config > 0) {
		dev_info(&udev->dev,
			 "apple_dfr_cfgsel: forcing configuration %d (module parameter)\n",
			 display_config);
		return display_config;
	}

	/*
	 * Auto mode: pick the configuration that exposes an Audio/Video
	 * (0x10) class interface.  The Touch Bar pixel-streaming interface
	 * only exists in the display-mode configuration (config 2 on T1).
	 */
	c = udev->config;
	num_configs = udev->descriptor.bNumConfigurations;
	for (i = 0; i < num_configs; i++, c++) {
		for (j = 0; j < c->desc.bNumInterfaces; j++) {
			struct usb_interface_descriptor *desc =
				&c->intf_cache[j]->altsetting->desc;

			if (desc->bInterfaceClass != USB_CLASS_AUDIO_VIDEO)
				continue;

			dev_info(&udev->dev,
				 "apple_dfr_cfgsel: selecting display-mode configuration %d (AV interface %d)\n",
				 c->desc.bConfigurationValue,
				 desc->bInterfaceNumber);
			return c->desc.bConfigurationValue;
		}
	}

	dev_warn(&udev->dev,
		 "apple_dfr_cfgsel: no Audio/Video class configuration found, using kernel default\n");
	return -ENODEV;
}

static const struct usb_device_id appledfr_cfgsel_id_table[] = {
	{ USB_DEVICE(APPLE_VID, IBRIDGE_T1_PID) },
	{ }
};
MODULE_DEVICE_TABLE(usb, appledfr_cfgsel_id_table);

static struct usb_device_driver appledfr_cfgsel_driver = {
	.name = "apple_dfr_cfgsel",
	.choose_configuration = appledfr_choose_configuration,
	.id_table = appledfr_cfgsel_id_table,
	.generic_subclass = 1,
	.supports_autosuspend = 1,
};

static int __init appledfr_cfgsel_init(void)
{
	/*
	 * Registration reprobes any 05ac:8600 currently bound to
	 * usb_generic_driver (__usb_bus_reprobe_drivers() in
	 * drivers/usb/core/driver.c): the generic driver's disconnect
	 * deconfigures the device, then our probe re-runs
	 * usb_choose_configuration() -> appledfr_choose_configuration().
	 */
	return usb_register_device_driver(&appledfr_cfgsel_driver,
					  THIS_MODULE);
}
module_init(appledfr_cfgsel_init);

static void __exit appledfr_cfgsel_exit(void)
{
	/* Device falls back to usb_generic_driver -> config 1 on reprobe. */
	usb_deregister_device_driver(&appledfr_cfgsel_driver);
}
module_exit(appledfr_cfgsel_exit);

MODULE_AUTHOR("Nori Nishigaya");
MODULE_DESCRIPTION("Apple T1 iBridge Touch Bar display-mode configuration selector");
MODULE_LICENSE("GPL");
