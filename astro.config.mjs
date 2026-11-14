import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // Sin sesiones ni transformación de imágenes de Cloudflare: no se necesitan
  // (así el deploy no pide KV ni Images). Se pueden activar más adelante.
  session: false,
  // Todas las páginas son dinámicas (SSR): no hace falta workerd durante el build.
  adapter: cloudflare({ imageService: 'passthrough', prerenderEnvironment: 'node' }),
});
