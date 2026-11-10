# Route wire material

The route ribbon uses the pulling-wire preview material from `Brain_LinkWire_Line.prefab` in the local game install. Its main trail renderer references `M_UI_lightingtrail`, shader `HGRP/Effect/VFXLine`. The prefab bundle is `main/1a977a0fac973098be34a299.ab`, material path ID `34063205321503037`.

## Texture data

`src/assets/wire-flow.bin` contains `T_fx_flow_30_M` from `CAB-f09163f9f9bbe64b7ce3d88a4601a0e9`, path ID `-8098814572473729256`. `wire-mask.bin` contains `T_fx_mask_24_C_M` from `CAB-8031a0a07a3a8cba360168d90dd3f12b`, path ID `-6839752139354832701`.

Both source textures are 256 × 256 sRGB BC7 with nine mip levels. Each binary holds the decoded red channel, largest mip first down to 1 × 1, in Unity's original row order. All decoded source texels have equal RGB channels and opaque alpha, verified for every mip. The renderer restores RGBA and uploads to `rgba8unorm-srgb` so sRGB decoding happens before hardware filtering. Vite inlines the binaries into the module. The runtime uses the bundled data without a game install or additional texture requests.

## Material transfer

The material's active `_USE_MASK` variant was decoded from its Vulkan SMOL-V program and inspected through SPIRV-Cross. The port uses its world-XZ main texture coordinates, 90-degree UV rotation, main UV speed `(-0.27, 0)`, unit texture scale, mask U offset `-3.43`, red-channel alpha selection for both textures, tint alpha `1`, intensity `1.5`, and source-alpha blending. The flow sampler repeats and the mask sampler clamps, with linear filtering and the original mip chains.

The host supplies elapsed seconds and substitutes each route segment's colour for the game tint. The existing route ribbon supplies CSS-pixel width, rounded antialiased ends, and depth-based occlusion/dash clipping. World coordinates are perspective-correct across the screen-space ribbon. Mask U uses cumulative route distance in metres and mask V spans the ribbon width. This adapts the game's generated trail UVs to the route polyline. Route points and camera-space clipping supply the UV endpoints, including segments crossing the near plane.

The prefab also has endpoint/ring renderers with `M_fx_UI_lightingtrail_02` and `_04`. The route material port covers the continuous line, whose referenced material is `M_UI_lightingtrail`.
