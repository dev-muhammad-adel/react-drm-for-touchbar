# Out-of-tree build for the T1 Touch Bar display-mode stack:
#   apple_dfr_cfgsel.ko - enumeration-time config selector (root fix)
#   appletbdrm.ko       - vendored from v7.0.10 drivers/gpu/drm/tiny/appletbdrm.c
#                         with the T1 (05ac:8600) id added; installs to
#                         updates/dkms which overrides the in-tree module.
#   apple_ibridge.ko    - config-1 driver with no forced config-2 revert.

obj-m += apple_dfr_cfgsel.o
obj-m += appletbdrm.o
obj-m += apple_ibridge.o

KVER ?= $(shell uname -r)
KDIR ?= /lib/modules/$(KVER)/build

default:
	$(MAKE) -C $(KDIR) M=$(CURDIR) modules

clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
