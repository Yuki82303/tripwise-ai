# Image attribution

The complete per-city inventory, author, license, original Wikimedia Commons file page and intended local filename are in [图片版权与来源清单.md](../../02-说明文档/图片版权与来源清单.md).

TripWise displays the author and license on each loaded destination photo card and links to its file page. If both the optional local JPEG and Commons image fail, the card displays a CSS illustration and hides its photo attribution. The development sandbox could not download photo bytes; `assets/destinations/` is empty apart from `.gitkeep`. Run `npm run photos:download` on a connected Mac, or manually save a checked Commons thumbnail under the filename listed in the inventory. Preserve any license conditions when redistributing a modified image.
