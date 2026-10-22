import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import {themes as prismThemes} from 'prism-react-renderer';

const config: Config = {
  title: 'Документация',
  url: 'https://serkoo10.github.io',
  baseUrl: '/docs/',
  organizationName: 'serkoo10',
  projectName: 'docs',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenAnchors: 'warn',
  markdown: {
    // .md из проектов — чистый CommonMark: угловые скобки и фигурные в тексте не ломают сборку
    format: 'detect',
    hooks: {onBrokenMarkdownLinks: 'warn'},
  },

  i18n: {defaultLocale: 'ru', locales: ['ru']},

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        pages: false,
        theme: {customCss: './src/css/custom.css'},
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {respectPrefersColorScheme: true},
    navbar: {
      title: 'Документация',
      items: [{type: 'docSidebar', sidebarId: 'docs', label: 'Проекты', position: 'left'}],
    },
    docs: {sidebar: {hideable: true, autoCollapseCategories: true}},
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'go', 'dart', 'sql', 'yaml', 'json', 'toml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
