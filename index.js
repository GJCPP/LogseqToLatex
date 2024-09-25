// const fs = require('fs');

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};



const is_debugging = true;



/*! For license information please see lsplugin.user.js.LICENSE.txt */


const DEFAULT_LOCALE = "en";
let locale$1 = DEFAULT_LOCALE;
let translations = {};
let filePrefix = "";
let fileSuffix = "";
let noIndentEnv = [];
let user_settings = {};
/*
* The user's settings. E.g. : if (user_settings.enableDollarBracket) { ... }
*/


var zhCN = {
    "Reload user functions": "重新加载用户函数",
    "User defined functions reloaded.": "用户函数已重新加载。",
};

async function setup({ defaultLocale = DEFAULT_LOCALE, builtinTranslations, }) {
    locale$1 = (await logseq.App.getUserConfigs()).preferredLanguage;
    if (locale$1 === defaultLocale)
        return;
    if (builtinTranslations?.[locale$1] != null) {
        translations = builtinTranslations;
    }
}


let regexRules = [];

function cleanUp() {
    const appContainer = parent.document.getElementById("app-container");

    // appContainer.removeEventListener("compositionend", inputHandler);

    appContainer.removeEventListener("input", inputHandler);
    appContainer.removeEventListener("beforeinput", beforeInputHandler);
    // appContainer.removeEventListener("keydown", keydownHandler);
}

async function getUserRules() {
    // const settings = logseq.settings;
    const file = await fetch('./snippets.json')
    var config;

    if (file.ok) { // if HTTP-status is 200-299
        config = await file.json();
    } else {
        console.error("HTTP-Error: ", file.status);
        return [];
    }

    if (is_debugging) {
        console.log("config", config.regex_rules);
    }

    const ret = []; // It initializes an empty array ret to store the parsed rules.

    // Read triggers and replacements from settings.latex_snippets, and store to the ret array.W

    for (const group of Object.keys(config.regex_rules)) {

        for (let i = 0; i < config.regex_rules[group].length; i++) {
            let rule = config.regex_rules[group][i];

            ret.push({
                trigger: new RegExp(`${rule.trigger}$`),
                repl: rule.replacement,
                head: rule.head,
                tail: rule.tail
            });
        }

        console.log(`Group ${group} loaded`);
    }

    filePrefix = config.prefix;
    fileSuffix = config.suffix;
    noIndentEnv = config.no_indent_env;

    return ret;
}

async function reloadUserRules() {
    const userRules = await getUserRules();

    if (userRules.length > 0) {
        regexRules = [
            ...userRules
        ];
    }

    if (is_debugging) {
        console.log("User rules:", regexRules);
    }
}

async function addLeadingTabs(str) {
    let lines = str.split('\n');
    let result = [];
    let indent = 0;
    let inSection = false;
    let inSubSection = false;
    let noIndent = 0;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        for (const env of noIndentEnv) {
            if (line.trim().startsWith(env.start)) {
                noIndent++;
                result.push("");
                break;
            }
        }
        if (line.trim().startsWith('\\section')) {
            if (inSection) {
                result.push(""); // Add a blank line to separate sections
            }
            result.push(`${line}`);
            indent = 1;
            inSection = true;
            inSubSection = false;
        } else if (line.trim().startsWith('\\subsection')) {
            if (inSubSection) {
                result.push(""); // Add a blank line to separate sections
            }
            result.push("\t" + `${line}`);
            indent = 2;
            inSection = false;
            inSubSection = true;
        } else if (line.trim().startsWith('\\subsubsection')) {
            result.push("\t\t" + `${line}`);
            indent = 3;
        } else if (line.trim().startsWith('\\begin')) {
            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);
            indent++;
        } else if (line.trim().startsWith('\\end')) {
            indent--;
            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);
        } else {
            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);
        }
        for (const env of noIndentEnv) {
            if (line.trim().startsWith(env.end)) {
                noIndent--;
                result.push("");
                break;
            }
        }
    }
    return result.join('\n');
}

async function explorePageBlocksTree(tree, depth) {
    let ret = tree.content;
    let head = "";
    let tail = "";

    // Match all markdown images and replace with counter + format
    const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
    let listOfAssets = await logseq.Assets.listFilesOfCurrentGraph();

    ret = ret.replace(imageRegex, (match, alt, url) => {
        // Truncate URL to the last slash and check if it matches any asset
        const truncatedUrl = url.substring(url.lastIndexOf('/') + 1);
        const matchingAsset = listOfAssets.find(asset => asset.path.endsWith(truncatedUrl));
        if (matchingAsset) {
            url = matchingAsset.path; // Use the full matching asset path
        }
        url = url.replace(/\\/g, "/");
        let replacement = `\\begin{figure}[h!]\\centering
        \\includegraphics[width=0.7\\textwidth]{${url}}
        \\end{figure}`;
        return replacement;
    });

    // Apply regex rules and replace matches
    for (const rule of regexRules) {
        let lastIndex = 0;
        let newRet = '';
        ret.replace(rule.trigger, (match, ...args) => {
            const index = args[args.length - 2];
            newRet += ret.slice(lastIndex, index);
            // Handle replacement, considering $1, $2, etc. in the string
            let replacement = rule.repl;
            replacement = replacement.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
            
            // Add head and tail if they exist
            if (rule.head && rule.head.length > 0) {
                head += rule.head + "\n";
            }
            if (rule.tail && rule.tail.length > 0) {
                tail = rule.tail + "\n" + tail;
            }
            newRet += replacement;
            lastIndex = index + match.length;
            
            return match; // This return value is not used
        });
        
        // Add any remaining text
        newRet += ret.slice(lastIndex);
        ret = newRet;
    }
    if (ret.length === 0 || ret[ret.length - 1] !== '\n') {
        ret += "\n";
    }

    let middle = "";
    for (const child of tree.children) {
        middle += await explorePageBlocksTree(child, depth + 1);
    }

    head = head.trim();
    ret = ret.trim();
    middle = middle.trim();
    tail = tail.trim();

    // Ensure the last character of ret, middle, and tail is a newline
    if (head.length > 0 && head[head.length - 1] !== '\n') {
        head += '\n';
    }
    if (ret.length > 0 && ret[ret.length - 1] !== '\n') {
        ret += '\n';
    }
    if (middle.length > 0 && middle[middle.length - 1] !== '\n') {
        middle += '\n';
    }
    if (tail.length > 0 && tail[tail.length - 1] !== '\n') {
        tail += '\n';
    }
    ret = head + ret + middle + tail;
    if (ret.length > 0 && ret[ret.length - 1] !== '\n') {
        ret += '\n';
    }
    return ret;
}

async function saveToFile(content, filename) {
    // Create a Blob with the content
    const prefix = filePrefix.join('\n');
    const suffix = fileSuffix.join('\n');
    const blob = new Blob([prefix + content + suffix], { type: 'text/plain' });

    // Create a URL for the Blob
    const url = URL.createObjectURL(blob);

    // Create a temporary anchor element
    const a = document.createElement('a');
    a.href = url;
    a.download = filename; // Set the filename

    // Append the anchor to the body, click it, and remove it
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke the Blob URL to free up memory
    URL.revokeObjectURL(url);

    console.log(`File "${filename}" created and download initiated.`);
}


async function handleToLatex() {
    console.log("ToLatex");
    let blocks = await logseq.Editor.getCurrentPageBlocksTree();
    let root = {children : blocks, content : ""};
    let ret = await explorePageBlocksTree(root, 0);
    ret = await addLeadingTabs(ret);
    const currentPage = await logseq.Editor.getCurrentPage();
    const filename = `${currentPage.name}.tex`;
    saveToFile(ret, filename);
}

async function main() {
    await setup({
        builtinTranslations: {
            "zh-CN": zhCN
        }
    });
    logseq.provideModel({
        handleToLatex
    });
    reloadUserRules();
    logseq.App.registerUIItem("toolbar", {
        key: "ToLatex",
        template: `
          <span class="logseq-to-latex">
            <a title="ToLatex" class="button" data-on-click="handleToLatex">
              <i class="ti ti-math-pi"></i>
            </a>
          </span>
        `
    });
    // init();

    // reloadUserRules();
}



logseq.ready(main).catch(console.error);
