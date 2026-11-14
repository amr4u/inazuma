/*
 * Optional zero-dependency fallback packager for environments without npm access.
 * Production builds should use WXT. This packager targets Firefox MV2 only.
 * Uses TypeScript's transpileModule; this is NOT a general-purpose bundler.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'dist-firefox-offline');
const posix = path.posix;
fs.rmSync(target, {recursive:true, force:true}); fs.mkdirSync(target, {recursive:true});

function bundle(entry, startup) {
  const modules = new Map();
  function add(id) {
    if (modules.has(id)) return;
    const file = path.join(root, id);
    if (!fs.existsSync(file)) throw new Error(`Missing TS module: ${id}`);
    const source = fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, {fileName:file, compilerOptions:{
      target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, strict:true,
    }}).outputText;
    modules.set(id, compiled);
    for(const match of compiled.matchAll(/\brequire\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      add(posix.normalize(posix.join(posix.dirname(id), match[1] + '.ts')));
    }
  }
  add(entry);
  const bundleText = `(() => {\n`+
    `const __modules = {\n${Array.from(modules,([id,js])=>`${JSON.stringify(id)}:function(require,module,exports){\n${js}\n}`).join(',\n')}\n};\n`+
    `const __cache = Object.create(null);\n`+
    `const __resolve = (from,p) => {const a = from.split('/');a.pop();for(const s of p.split('/')){if(s==='..')a.pop();else if(s!=='.')a.push(s);}return a.join('/')+'.ts';};\n`+
    `function __load(id){if(__cache[id])return __cache[id].exports;const fn=__modules[id];if(!fn)throw Error('Module not found: '+id);const m={exports:{}};__cache[id]=m;fn(p=>__load(__resolve(id,p)),m,m.exports);return m.exports;}\n`+
    `const defineBackground = (cfg)=>cfg; const defineContentScript=(cfg)=>cfg;\n`+
    `const __entry = __load(${JSON.stringify(entry)});\n${startup}\n})();\n`;
  return bundleText;
}
function write(out,text) { const p=path.join(target,out);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text); }
write('background.js',bundle('entrypoints/background.ts','__entry.default.main();'));
write('content.js',bundle('entrypoints/content.ts','__entry.default.main();'));
for(const section of ['popup','options']) {
  write(`${section}/main.js`,bundle(`entrypoints/${section}/main.ts`,''));
  const page=fs.readFileSync(path.join(root,`entrypoints/${section}/index.html`),'utf8')
    .replace('../../src/app/style.css','./style.css').replace('./main.ts','./main.js');
  write(`${section}/index.html`,page);
  write(`${section}/style.css`,fs.readFileSync(path.join(root,'src/app/style.css'),'utf8'));
}
const manifest={
  manifest_version:2,
  name:'Decision Formfill',version:'0.1.0',
  description:'Decision-driven form filling with encrypted local profiles.',
  browser_specific_settings:{gecko:{id:'decision-formfill@local.example',strict_min_version:'140.0',
    data_collection_permissions:{required:['websiteContent','browsingActivity','authenticationInfo']}},gecko_android:{strict_min_version:'142.0'}},
  permissions:['storage','tabs','<all_urls>','https://api.cloudflare.com/*'],
  background:{scripts:['background.js'],persistent:true},
  content_scripts:[{matches:['<all_urls>'],js:['content.js'],run_at:'document_idle'}],
  browser_action:{default_title:'Decision Formfill',default_popup:'popup/index.html'},
  options_ui:{page:'options/index.html',open_in_tab:true},
};
write('manifest.json',JSON.stringify(manifest,null,2));
console.log(`Built Firefox extension at ${target}`);
