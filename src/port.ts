import tgpu from 'typegpu';
import { createPostFx } from '../legacy/postfx.ts';
import type { Pixels, ShaderName } from './reference.ts';

export async function createPort() {
  const root = await tgpu.init();
  const errors: string[] = [];
  root.device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  return {
    renderer: {
      vendor: root.device.adapterInfo.vendor,
      architecture: root.device.adapterInfo.architecture,
      device: root.device.adapterInfo.device,
      description: root.device.adapterInfo.description,
    },
    async render(name: ShaderName, image: Pixels, output: { width: number; height: number }): Promise<Pixels> {
      const post = createPostFx(root, { width: image.width, height: image.height, surfaceFormat: 'rgba8unorm' });
      await post.ready;
      post.controls.find((p) => p.name === 'shader')!.value = name === 'lottes' ? 1 : 2;
      const target = root.device.createTexture({ size: [output.width, output.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const bytesPerRow = Math.ceil(output.width * 4 / 256) * 256;
      const buffer = root.device.createBuffer({ size: bytesPerRow * output.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        root.device.queue.writeTexture({ texture: post.sceneTexture }, image.rgba, { bytesPerRow: image.width * 4 }, [image.width, image.height]);
        const encoder = root.device.createCommandEncoder();
        post.encode(encoder, target.createView(), output, { time: 0, flash: 0, fade: 0 });
        encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [output.width, output.height]);
        root.device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        if (errors.length) throw new Error(errors.splice(0).join('\n'));
        const padded = new Uint8Array(buffer.getMappedRange());
        const rgba = new Uint8Array(output.width * output.height * 4);
        for (let y = 0; y < output.height; y++) rgba.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + output.width * 4), y * output.width * 4);
        buffer.unmap();
        return { ...output, rgba };
      } finally {
        target.destroy();
        buffer.destroy();
        post.dispose();
      }
    },
    dispose() { root.destroy(); },
  };
}
