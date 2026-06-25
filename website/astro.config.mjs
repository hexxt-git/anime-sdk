import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL,
  server: { port: 4321 },
  integrations: [
    starlight({
      title: 'anime-sdk',
      description: 'Typescript SDK for building anime apps',
      favicon: '/anime-sdk.ico',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/hexxt-git/anime-sdk' }],
      customCss: ['./src/styles/starlight.css'],
      components: {
        ThemeSelect: './src/components/ThemeSelect.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        Head: './src/components/StarlightHead.astro',
      },
      disable404Route: true,
      sidebar: [
        { label: 'Getting Started', link: '/docs/' },
        {
          label: 'Providers',
          items: [
            { label: 'Overview', link: '/docs/providers/' },
            { label: 'AllManga', link: '/docs/providers/allmanga/' },
            { label: 'AnimeParadise', link: '/docs/providers/animeparadise/' },
            { label: 'Gogoanime', link: '/docs/providers/gogoanime/' },
            { label: 'Anikoto', link: '/docs/providers/anikoto/' },
            { label: 'MegaPlay', link: '/docs/providers/megaplay/' },
            { label: 'Goyabu', link: '/docs/providers/goyabu/' },
            { label: 'MangaDex', link: '/docs/providers/mangadex/' },
            { label: 'WeebCentral', link: '/docs/providers/weebcentral/' },
            { label: 'MangaPill', link: '/docs/providers/mangapill/' },
          ],
        },
        {
          label: 'Metadata',
          items: [
            { label: 'AniList', link: '/docs/providers/anilist/' },
            { label: 'MyAnimeList', link: '/docs/providers/mal/' },
            { label: 'Kitsu', link: '/docs/providers/kitsu/' },
          ],
        },
        { label: 'HTTP Server', link: '/docs/http-server/' },
        { label: 'Stream Proxy', link: '/docs/proxy/' },
        { label: 'Downloads', link: '/docs/download/' },
        { label: 'API Reference', link: '/docs/api-reference/' },
        { label: 'Contributing', link: '/docs/contributing/' },
      ],
    }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
