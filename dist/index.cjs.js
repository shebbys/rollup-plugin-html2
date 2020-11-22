'use strict';

var fs = require('fs');
var htmlMinifier = require('html-minifier');
var nodeHtmlParser = require('node-html-parser');
var path = require('path');

/** Where to insert the external */
var ExternalPosition;
(function (ExternalPosition) {
    /** Insert before generated entries. */
    ExternalPosition["before"] = "before";
    /** Insert after generated entries. */
    ExternalPosition["after"] = "after";
})(ExternalPosition || (ExternalPosition = {}));
/**
 * Enumeration indicates whether CORS must be used when fetching the resource
 *
 * If the attribute is `undefined`, the resource is fetched without a CORS
 * request.
 *
 * [Details](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link)
 */
var Crossorigin;
(function (Crossorigin) {
    /** A cross-origin request is performed, but no credential is sent. */
    Crossorigin["anonymous"] = "anonymous";
    /** A cross-origin request is performed along with a credential sent. */
    Crossorigin["usecredentials"] = "use-credentials";
})(Crossorigin || (Crossorigin = {}));

const getChildElement = (node, tag, append = true) => {
    let child = node.querySelector(tag);
    if (!child) {
        child = new nodeHtmlParser.HTMLElement(tag, {});
        if (append) {
            node.appendChild(child);
        }
        else {
            node.childNodes.unshift(child);
        }
    }
    return child;
};
const addNewLine = (node) => node.appendChild(new nodeHtmlParser.TextNode('\n  '));
const normalizePreload = (preload) => {
    if (!preload) {
        preload = [];
    }
    if (preload instanceof Array) {
        preload = new Set(preload);
    }
    return preload;
};
const normalizePrefix = (prefix = '') => {
    if (prefix && !prefix.endsWith('/')) {
        prefix += '/';
    }
    return prefix;
};
const extensionToType = (ext) => {
    switch (ext) {
        case 'css': return 'style';
        case 'js': return 'script';
        default: return null;
    }
};
const isChunk = (item) => (item.type === 'chunk');
const bundleReducer = (prev, cur) => {
    if (isChunk(cur)) {
        // Use full name with possible hash and without extension to process
        // possible CSS files and other assets with same name of entry
        const { name } = path.parse(cur.fileName);
        if (cur.isEntry) {
            prev.entries[name] = cur.name;
        }
        else if (cur.isDynamicEntry) {
            prev.dynamicEntries[name] = cur.name;
        }
    }
    return prev;
};
const formatSupportsModules = (f) => (f === 'es'
    || f === 'esm'
    || f === 'module');
const checkEnum = (enumobj, val) => (!val || Object.values(enumobj).includes(val));
const checkBoolean = (context, name, value) => {
    const type = typeof value;
    if (type !== 'boolean' && type !== 'undefined') {
        context.error(`Invalid \`${name}\` argument: ${JSON.stringify(value)}`);
    }
};
const checkModulesOption = (context, name, format, value) => {
    if (value) {
        context.error(`The \`${name}\` option is set to true but the output.format is ${format}, \
consider to use another format or switch off the option`);
    }
};
const injectCSSandJSFactory = (head, body, modules, nomodule) => {
    const moduleattr = modules ? 'type="module" '
        : nomodule ? 'nomodule '
            : '';
    return (fileName, type, pos, crossorigin) => {
        const cors = crossorigin ? `crossorigin="${crossorigin}" ` : '';
        if (type === "css" /* css */) {
            const parent = pos === "body" /* body */ ? body : head;
            addNewLine(parent);
            parent.appendChild(new nodeHtmlParser.HTMLElement('link', {}, `rel="stylesheet" ${cors}href="${fileName}"`));
        }
        else {
            const parent = pos === "head" /* head */ ? head : body;
            addNewLine(parent);
            parent.appendChild(new nodeHtmlParser.HTMLElement('script', {}, `${moduleattr}${cors}src="${fileName}"`));
        }
    };
};
const extrenalsProcessorFactory = (injectCSSandJS, externals) => {
    if (!externals) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        return () => { };
    }
    return (processPos) => {
        for (const { pos, file, type, crossorigin } of externals) {
            if (pos === processPos) {
                injectCSSandJS(file, type || path.extname(file).slice(1), undefined, crossorigin);
            }
        }
    };
};
const html2 = ({ template, file: deprecatedFileOption, fileName: htmlFileName, inject, title, favicon, meta, externals, preload, modules, nomodule, minify: minifyOptions, onlinePath, ...options }) => ({
    name: 'html2',
    buildStart() {
        if (deprecatedFileOption) {
            this.error('The `file` option is deprecated, use the `fileName` instead.');
        }
        const templateIsFile = fs.existsSync(template);
        if (templateIsFile && fs.lstatSync(template).isFile()) {
            this.addWatchFile(template);
        }
        else if (!htmlFileName) {
            this.error('When `template` is an HTML string the `fileName` option must be defined');
        }
        this.cache.set("templateIsFile" /* templateIsFile */, templateIsFile);
        if (favicon && !(fs.existsSync(favicon) && fs.lstatSync(favicon).isFile())) {
            this.error('The provided favicon file does\'t exist');
        }
        if (typeof inject === 'string' && !(inject === "head" /* head */ || inject === "body" /* body */)) {
            this.error('Invalid inject argument: ' + inject);
        }
        if (externals) {
            for (const { pos, crossorigin } of externals) {
                if (!checkEnum(ExternalPosition, pos)) {
                    this.error('Invalid position for the extrenal: ' + pos);
                }
                if (!checkEnum(Crossorigin, crossorigin)) {
                    this.error('Invalid crossorigin argument for the extrenal: ' + crossorigin);
                }
            }
        }
        checkBoolean(this, 'modules', modules);
        checkBoolean(this, 'nomodule', nomodule);
        Object.keys(options).forEach(o => this.warn(`Ignoring unknown option "${o}"`));
    },
    outputOptions({ dir, file: bundleFile, format }) {
        if (!htmlFileName) {
            let distDir = process.cwd();
            if (dir) {
                distDir = path.resolve(distDir, dir);
            }
            else if (bundleFile) {
                const bundleDir = path.dirname(bundleFile);
                distDir = path.isAbsolute(bundleDir) ? bundleDir : path.resolve(distDir, bundleDir);
            }
            // Template is always a file path
            htmlFileName = path.resolve(distDir, path.basename(template));
            if (htmlFileName === path.resolve(template)) {
                this.error('Could\'t write the generated HTML to the source template, define one of the options: `file`, `output.file` or `output.dir`');
            }
        }
        if (modules && nomodule) {
            this.error('Options `modules` and `nomodule` cannot be set at the same time');
        }
        const modulesSupport = formatSupportsModules(format);
        checkModulesOption(this, 'modules', format, modules && !modulesSupport);
        checkModulesOption(this, 'nomodule', format, nomodule && modulesSupport);
        return null;
    },
    generateBundle(output, bundle) {
        const data = this.cache.get("templateIsFile" /* templateIsFile */)
            ? fs.readFileSync(template).toString()
            : template;
        const doc = nodeHtmlParser.parse(data, {
            pre: true,
            script: true,
            style: true,
        });
        const html = doc.querySelector('html');
        if (!html) {
            this.error('The input template doesn\'t contain the `html` tag');
        }
        const html = doc.querySelector('html');
        const head = getChildElement(html, 'head', false);
        const body = getChildElement(html, 'body');
        if (meta) {
            const nodes = head.querySelectorAll('meta');
            Object.entries(meta).forEach(([name, content]) => {
                const oldMeta = nodes.find(n => n.attributes.name === name);
                const newMeta = new nodeHtmlParser.HTMLElement('meta', {}, `name="${name}" content="${content}"`);
                if (oldMeta) {
                    head.exchangeChild(oldMeta, newMeta);
                }
                else {
                    addNewLine(head);
                    head.appendChild(newMeta);
                }
            });
        }
        const { __favicons_output: favicons = [] } = output;
        favicons.forEach(f => {
            head.appendChild(new nodeHtmlParser.TextNode(f));
            addNewLine(head);
        });
        if (title) {
            let node = head.querySelector('title');
            if (!node) {
                addNewLine(head);
                node = new nodeHtmlParser.HTMLElement('title', {});
                head.appendChild(node);
            }
            node.set_content(title);
        }
        if (favicon) {
            const nodes = head.querySelectorAll('link');
            const rel = 'shortcut icon';
            const oldLink = nodes.find(n => n.attributes.rel === rel);
            const fileName = path.basename(favicon);
            const newLink = new nodeHtmlParser.HTMLElement('link', {}, `rel="${rel}" href="${fileName}"`);
            if (oldLink) {
                head.exchangeChild(oldLink, newLink);
            }
            else {
                addNewLine(head);
                head.appendChild(newLink);
            }
            this.emitFile({
                fileName,
                source: fs.readFileSync(favicon),
                type: 'asset',
            });
        }
        const injectCSSandJS = injectCSSandJSFactory(head, body, modules, nomodule);
        const processExternals = extrenalsProcessorFactory(injectCSSandJS, externals);
        // Inject externals before
        processExternals(ExternalPosition.before);
        // Inject generated files
        if (inject !== false) {
            const files = Object.values(bundle);
            // First of all get entries
            const { entries, dynamicEntries } = files.reduce(bundleReducer, {
                dynamicEntries: {},
                entries: {},
            });
            // Now process all files and inject only entries and preload files
            preload = normalizePreload(preload);
            const prefix = normalizePrefix(onlinePath);
            files.forEach(({ fileName }) => {
                const { name, ext } = path.parse(fileName);
                const injectType = ext.slice(1);
                const filePath = prefix + fileName;
                if (name in entries) {
                    injectCSSandJS(filePath, injectType, inject);
                }
                else if (name in dynamicEntries && preload.has(dynamicEntries[name])) {
                    const linkType = extensionToType(injectType);
                    if (linkType) {
                        addNewLine(head);
                        head.appendChild(new nodeHtmlParser.HTMLElement('link', {}, `rel="preload" href="${filePath}" as="${linkType}"`));
                    }
                }
            });
        }
        // Inject externals after
        processExternals(ExternalPosition.after);
        let source = '<!doctype html>\n' + doc.toString();
        if (minifyOptions) {
            source = htmlMinifier.minify(source, minifyOptions);
        }
        // `file` has been checked in the `outputOptions` hook
        this.emitFile({
            fileName: path.basename(htmlFileName),
            source,
            type: 'asset',
        });
    },
});

module.exports = html2;
