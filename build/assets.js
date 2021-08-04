// =============================================================================
// Mathigon Studio Build Assets
// (c) Mathigon
// =============================================================================


const fs = require('fs');
const path = require('path');
const glob = require('glob');
const esbuild = require('esbuild');
const pug = require('pug');
const sass = require('sass');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const rtlcss = require('rtlcss');

const {error, readFile, success, writeFile, CONFIG, STUDIO_ASSETS, PROJECT_ASSETS, CONTENT, OUTPUT, watchFiles, findFiles, textHash} = require('./utilities');
const {parseCourse, COURSE_URLS, writeCache} = require('./markdown');


// -----------------------------------------------------------------------------
// Styles

/** Supported browsers */
const BROWSERLIST = ['defaults', 'not ie <= 11', 'not ios < 10'];

/** CSS properties to exclude from RTL conversion. */
const RTL_EXCLUDE = ['background', 'background-color', 'background-image',
  'background-repeat', 'background-size', 'cursor'];

const SAFE_AREA_VARS = ['safe-area-inset-top', 'safe-area-inset-bottom',
  'safe-area-inset-left', 'safe-area-inset-right'];

/** Custom PostCSS plugin for converting safe-area variables for iOS. */
const safeAreaCSS = {
  postcssPlugin: 'safe-area-inset',
  Root(root) {
    root.walkDecls(decl => {
      const vars = decl.value.match(/env\(([\w-]+)\)/g) || [];
      const match = SAFE_AREA_VARS.some(s => vars.includes(`env(${s})`));
      if (!match) return;

      let fallback1 = decl.value;
      let fallback2 = decl.value;

      for (const key of SAFE_AREA_VARS) {
        const regex = new RegExp(`env\\(${key}\\)`, 'g');
        fallback1 = fallback1.replace(regex, '0px');
        fallback2 = fallback2.replace(regex, `constant(${key})`);
      }

      decl.before(`${decl.prop}:${fallback1}`);
      decl.before(`${decl.prop}:${fallback2}`);
    });
  }
};

async function bundleStyles(srcPath, destPath, minify = false, watch = false) {
  if (destPath.endsWith('.scss')) destPath = destPath.replace('.scss', '.css');

  const start = Date.now();
  const rtl = false;  // TODO Generate rtl files

  let output = sass.renderSync({
    file: srcPath,
    functions: {
      'uri-encode($str)': (str) => new sass.types.String(encodeURIComponent(str.getValue()))
    }
  });
  const files = output.stats.includedFiles;

  const postCSSOptions = [autoprefixer(BROWSERLIST), safeAreaCSS];
  if (rtl) postCSSOptions.shift(rtlcss({blacklist: RTL_EXCLUDE}));
  if (minify) postCSSOptions.push(cssnano());
  output = (await postcss(postCSSOptions).process(output.css, {from: undefined})).css;

  // TODO Use github.com/madyankin/postcss-modules to scope all component classes
  output = `/* ${CONFIG.banner}, generated by Mathigon Studio */\n` + output;
  await writeFile(destPath, output);

  if (watch) {
    watchFiles(files, () => bundleStyles(srcPath, destPath, rtl, minify));
    // TODO Update watched files when output.includedFiles changes
  }

  const ms = Date.now() - start;
  success(srcPath, ms);
}


// -----------------------------------------------------------------------------
// Scripts

// Custom Rollup plugin for importing PUG files in TS.
// TODO Implement __() and generate translated bundles for each locale.
const pugOptions = {__: x => x, config: CONFIG};
const pugPlugin = {
  name: 'pug',
  setup: (build) => {
    build.onLoad({filter: /\.pug$/}, (args) => {
      const code = fs.readFileSync(args.path, 'utf8');
      const options = {compileDebug: false, filename: args.path, doctype: 'html'};
      const compiled = pug.compile(code, options)(pugOptions);
      return {contents: 'export default ' + JSON.stringify(compiled)};
    });
  }
};

const externalPlugin = {
  name: 'external',
  setup(build) {
    // TODO Make the list of external dependencies configurable. Maybe we don't
    // need this at all: Rollup has a .global configuration option?
    build.onResolve({filter: /^(vue|THREE)$/}, args => ({path: args.path, external: true}));
  }
};

async function bundleScripts(srcPath, destPath, minify = false, watch = false, name = undefined, env = 'WEB') {
  if (destPath.endsWith('.ts')) destPath = destPath.replace('.ts', '.js');
  if (srcPath.endsWith('.d.ts')) return;  // Skip declaration files

  const start = Date.now();

  const result = await esbuild.build({
    entryPoints: [srcPath],
    define: {ENV: `"${env}"`},  // could also be '"MOBILE"'
    bundle: true,
    minify,
    globalName: name,
    platform: 'browser',
    format: 'iife',
    plugins: [pugPlugin, externalPlugin],
    external: ['vue'],
    target: ['es2016'],
    metafile: watch,
    write: false,
    banner: {js: `/* ${CONFIG.banner}, generated by Mathigon Studio */`}
  });

  for (const file of result.outputFiles) {
    const text = file.text.replace(/\/\*![\s\S]*?\*\//g, '')
        .replace(/require\(['"]vue['"]\)/g, 'window.Vue')
        .replace(/\/icons\.svg/, iconsPath)  // Cache busting for icons
        .trim();
    await writeFile(destPath, text);
  }

  if (watch) {
    const cwd = process.cwd();
    const files = Object.keys(result.metafile.inputs).filter(f => !f.startsWith('node_modules')).map(f => path.join(cwd, f));
    watchFiles(files, () => bundleScripts(srcPath, destPath, minify, false, name));
    // TODO Update watched files when output.includedFiles changes
  }

  const ms = Date.now() - start;
  success(srcPath, ms);
}


// -----------------------------------------------------------------------------
// Markdown Courses

async function bundleMarkdown(id, locale, allLocales, watch = false, base = CONTENT) {
  const start = Date.now();

  const data = await parseCourse(path.join(base, id), locale, allLocales);
  if (!data) return;

  if (data.course) {
    const dest = path.join(OUTPUT, 'content', id, `data_${locale}.json`);
    await writeFile(dest, JSON.stringify(data.course));
    writeCache();
    success(`course ${id} [${locale}]`, Date.now() - start);
  }

  // TODO Also watch markdown dependencies (e.g. SVG, PUG or YAML files)
  if (watch) watchFiles([data.srcFile], () => bundleMarkdown(id, locale, allLocales, false, base));
}


// -----------------------------------------------------------------------------
// Miscellaneous Files

let iconsPath = '/icons.svg';

async function bundleIcons() {
  const start = Date.now();
  const icons = getAssetFiles('assets/icons/*.svg').map(({src}) => {
    const id = path.basename(src, '.svg');
    return readFile(src).replace(' xmlns="http://www.w3.org/2000/svg"', '')
        .replace('<svg ', `<symbol id="${id}" `).replace('</svg>', '</symbol>');
  });

  const symbols = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${icons.join('')}</svg>`;

  const hash = textHash(symbols).slice(0, 8);
  iconsPath = `/icons.${hash}.svg`;  // Add cache bust

  await writeFile(path.join(OUTPUT, 'icons.svg'), symbols);
  success(`icons.svg`, Date.now() - start);
}

async function createPolyfill() {
  const src = path.join(__dirname, '../node_modules');
  const f1 = readFile(src + '/web-animations-js/web-animations.min.js');
  const f2 = readFile(src + '/@webcomponents/custom-elements/custom-elements.min.js');

  const polyfill = [f1, f2].join('\n').replace(/\n\/\/# sourceMappingURL=.*\n/g, '\n');  // No Sourcemaps
  await writeFile(path.join(OUTPUT, 'polyfill.js'), polyfill);
}

async function createSitemap(URLs = []) {
  // TODO Generate sitemaps for locale subdomains
  // TODO Automatically generate the sitemap from Express router, rather than manually adding paths to config.yaml
  const options = '<changefreq>weekly</changefreq><priority>1.0</priority>';
  const urls = ['/', ...Array.from(COURSE_URLS), ...CONFIG.sitemap, ...URLs]
      .map(url => `<url><loc>https://${CONFIG.domain}${url}</loc>${options}</url>`);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
  await writeFile(path.join(OUTPUT, 'sitemap.xml'), sitemap);
}


// -----------------------------------------------------------------------------
// Tools

/** Get the basename of a path, but resolve /a/b/c/index.js to c.js. */
function basename(p) {
  const name = path.basename(p);
  const ext = path.extname(p);
  if (name.startsWith('index.')) return path.dirname(p).split(path.sep).pop() + ext;
  return name;
}

/**
 * Select all files in the project or the core frontend/ directory. Note that
 * the project may overwrite files with the same name.
 */
function getAssetFiles(pattern) {
  // Match abc.js as well as abc/index.js
  pattern = pattern.replace('*', '{*,*/index}');

  const projectFiles = glob.sync(pattern, {cwd: PROJECT_ASSETS}).map(c => path.join(PROJECT_ASSETS, c));
  const projectFileNames = projectFiles.map(p => basename(p));

  // Don't include any core files that are overwritten by the project.
  const studioFiles = glob.sync(pattern, {cwd: STUDIO_ASSETS}).map(c => path.join(STUDIO_ASSETS, c))
      .filter(p => !projectFileNames.includes(basename(p)));

  return [...studioFiles, ...projectFiles].map(src => {
    const dest = path.join(OUTPUT, basename(src));
    return {src, dest};
  });
}

async function buildAssets(minify = false, watch = false, locales = ['en']) {
  const promises = [];

  // SVG Icons need to be built BEFORE TS files, so that iconsPath is set.
  await bundleIcons().catch(error('icons.svg'));

  // Top-level TypeScript files
  for (const {src, dest} of getAssetFiles('*.ts')) {
    if (src.endsWith('.d.ts')) continue;
    promises.push(bundleScripts(src, dest, minify, watch).catch(error(src)));
  }
  promises.push(await createPolyfill().catch(error('polyfill.js')));

  // Top-level SCSS files
  for (const {src, dest} of getAssetFiles('*.scss')) {
    promises.push(bundleStyles(src, dest, minify, watch).catch(error(src)));
  }

  // Course TypeScript Files
  for (const {src, dest} of findFiles('!(shared|_*)/*.ts', CONTENT, OUTPUT + '/content')) {
    promises.push(bundleScripts(src, dest, minify, watch, 'StepFunctions').catch(error(src)));
  }

  // Course SCSS Files
  for (const {src, dest} of findFiles('!(shared|_*)/*.scss', CONTENT, OUTPUT + '/content')) {
    promises.push(bundleStyles(src, dest, minify, watch).catch(error(src)));
  }

  await Promise.all(promises);

  // Course Markdown and YAML files
  // We run all course scripts in series, to avoid memory issues with large repositories.
  const courses = glob.sync('!(shared|_*|*.*)', {cwd: CONTENT});
  for (const id of courses) {
    for (const locale of locales) {
      await bundleMarkdown(id, locale, locales, watch).catch(error(`course ${id} [${locale}]`));
    }
  }

  // Generate the sitemap after all other assets have been compiled
  await createSitemap().catch(error('sitemap.xml'));
}


module.exports.bundleStyles = bundleStyles;
module.exports.bundleScripts = bundleScripts;
module.exports.bundleMarkdown = bundleMarkdown;
module.exports.bundleIcons = bundleIcons;
module.exports.createSitemap = createSitemap;
module.exports.createPolyfill = createPolyfill;

module.exports.buildAssets = buildAssets;
