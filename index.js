// const fs = require('fs');

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};



const is_debugging = true;



/*! For license information please see lsplugin.user.js.LICENSE.txt */


const DEFAULT_LOCALE = "en";
let locale$1 = DEFAULT_LOCALE;
let translations = {};
let filePrefix = "";
let fileSuffix = "";
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



function cleanUp() {
    const appContainer = parent.document.getElementById("app-container");

    // appContainer.removeEventListener("compositionend", inputHandler);

    appContainer.removeEventListener("input", inputHandler);
    appContainer.removeEventListener("beforeinput", beforeInputHandler);
    // appContainer.removeEventListener("keydown", keydownHandler);
}

async function getUserRules() {
    const file = await fetch('./reg_rule.json')
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
                trigger: new RegExp(`${rule.trigger}`, 'g'),
                repl: rule.replacement,
                head: rule.head,
                tail: rule.tail,
                pushfront: rule.pushfront,
                pushback: rule.pushback
            });
        }

        console.log(`Group ${group} loaded`);
    }

    filePrefix = config.prefix;
    fileSuffix = config.suffix;
    noIndentEnv = config.no_indent_env.map(env => ({
        start: new RegExp(env.start, 'g'),
        end: new RegExp(env.end, 'g')
    }));
    noParEnv = config.no_par_env.map(env => ({
        start: new RegExp(env.start, 'g'),
        end: new RegExp(env.end, 'g')
    }));
    protectEnv = config.protect_env.map(env => ({
        range: new RegExp(env.range, 'g')
    }));
    let groupOfRules = config.content_regex_rules;
    let contentRules = [];
    for (const ruleGroup in groupOfRules) {
        for (const rule of groupOfRules[ruleGroup]) {
            contentRules.push({
                trigger: new RegExp(`${rule.trigger}`, 'g'),
                repl: rule.replacement,
                head: rule.head,
                tail: rule.tail,
                pushfront: rule.pushfront,
                pushback: rule.pushback
            });
        }
    }
    return { regexRules: ret, contentRegexRules: contentRules, noIndentEnv: noIndentEnv, noParEnv: noParEnv, protectEnv: protectEnv };
}

async function reloadUserRules() {
    const config = await getUserRules();

    if (is_debugging) {
        console.log("User config", config);
    }

    return config;
}

function getProtectedRanges(content, config) {
    const protectedRanges = [];
    for (const env of config.protectEnv) {
        let match;
        while ((match = env.range.exec(content)) !== null) {
            protectedRanges.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }
    }
    return protectedRanges;
}

function isProtected(index, length, protectedRanges) {
    for (const range of protectedRanges) {
        if (!(index >= range.end && index + length <= range.start)) {
            return true;
        }
    }
    return false;
}

function matchNonProtected(regex, content, protectedRanges) {
    let match;
    while ((match = regex.exec(content)) !== null) {
        const index = match.index;
        const length = match[0].length;
        if (!isProtected(index, length, protectedRanges)) {
            return match;
        }
    }
    return null;
}

async function addLeadingTabs(contentArray, config) {
    let result = [];
    let indent = 0;
    let inSection = false;
    let inSubSection = false;
    let noIndent = 0;
    for (let i = 0; i < contentArray.length; i++) {
        let line = contentArray[i];
        let protectedRanges = getProtectedRanges(line, config);
        let match;
        for (const env of config.noIndentEnv) {
            if (env.start.test(line)) {
                noIndent++;
                break;
            }
        }
        if (line.trim().startsWith("\\chapter")) {
            indent = 0;
        } else if (line.trim().startsWith('\\section')) {
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
        } else if (match = matchNonProtected(/^\\begin\{.*?\}$/, line, protectedRanges)) {
            // Check if we can find the corresponding \end{...}
            const beginMatch = match[0];
            const envName = beginMatch.match(/\\begin\{(.*?)\}/)[1];
            const endPattern = new RegExp(`\\\\end\\{${envName}\\}`);
            const hasMatchingEnd = contentArray.slice(i + 1).some(line => endPattern.test(line));
            
            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);

            if (!hasMatchingEnd) {
                // If no matching \end{...} is found, increase indent
                indent++;
            }
        } else if (match = matchNonProtected(/^\\end\{.*?\}$/, line, protectedRanges)) {
            indent--;
            if (indent < 0) {
                indent = 0;
            }
            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);
        } else {
            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);
        }
        for (const env of config.noIndentEnv) {
            if (env.end.test(line)) {
                noIndent--;
                break;
            }
        }
    }
    return result;
}

function applyRegexRules(content, head, tail, config) {
    // Extract protected ranges
    const protectedRanges = getProtectedRanges(content, config);


    for (const rule of config.regexRules) {
        let front = "";
        let back = "";
        let lastIndex = 0;
        let newContent = '';
        content.replace(rule.trigger, (match, ...args) => {
            // console.log("content", content);
            // console.log("match", match);
            const index = args[args.length - 2];

            // Check if the current match is within any protected range
            const isProtectedRange = isProtected(index, match.length, protectedRanges);

            if (isProtectedRange) {
                // If protected, don't apply the rule
                newContent += content.slice(lastIndex, index + match.length);
                lastIndex = index + match.length;
                return match;
            }
            
            newContent += content.slice(lastIndex, index);
            // Handle replacement, considering $1, $2, etc. in the string
            let replacement = rule.repl;
            if (replacement || replacement === "") {
                replacement = replacement.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
            } else {
                replacement = match;
            }
            
            // Add head and tail if they exist
            if (rule.head && rule.head.length > 0) {
                head.push(rule.head.replace(/\$(\d+)/g, (_, n) => args[n - 1] || ''));
            }
            if (rule.tail && rule.tail.length > 0) {
                tail.unshift(rule.tail.replace(/\$(\d+)/g, (_, n) => args[n - 1] || ''));
            }
            if (rule.pushfront && rule.pushfront.length > 0) {
                front += rule.pushfront.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
            }
            if (rule.pushback && rule.pushback.length > 0) {
                back += rule.pushback.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
            }
            newContent += replacement;
            lastIndex = index + match.length;
            
            return match; // This return value is not used
        });
        
        // Add any remaining text
        newContent += content.slice(lastIndex);
        if (front.length > 0 || back.length > 0) {
            newContent = newContent.trim();
        }
        content = front + newContent + back;
    }
    return content;
}

function applyContentRegexRules(contentArray, head, tail, config) {
    let newContentArray = contentArray.slice();
    for (const rule of config.contentRegexRules) {
        let matched = false;
        let nextContentArray = [];
        for (const content of newContentArray) {
            let front = "";
            let back = "";
            let lastIndex = 0;
            let newContent = '';
            let protectedRanges = getProtectedRanges(content, config);
            content.replace(rule.trigger, (match, ...args) => {
                const index = args[args.length - 2];
                newContent += content.slice(lastIndex, index);

                // Check if the current match is within any protected range
                const isProtectedRange = isProtected(index, match.length, protectedRanges);

                // If protected, don't apply the rule
                if (isProtectedRange) {
                    newContent += content.slice(lastIndex, index + match.length);
                    lastIndex = index + match.length;
                    return match;
                }

                // Handle replacement, considering $1, $2, etc. in the string
                let replacement = rule.repl;
                if (replacement || replacement === "") {
                    replacement = replacement.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
                } else {
                    replacement = match;
                }
                
                if (rule.pushfront && rule.pushfront.length > 0) {
                    front += rule.pushfront.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
                }
                if (rule.pushback && rule.pushback.length > 0) {
                    back += rule.pushback.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
                }
                
                // Add head and tail if they exist
                let needTrim = false;
                if (!matched && rule.head && rule.head.length > 0) {
                    head.push(rule.head.replace(/\$(\d+)/g, (_, n) => args[n - 1] || ''));
                    needTrim = true;
                }
                if (!matched && rule.tail && rule.tail.length > 0) {
                    tail.unshift(rule.tail.replace(/\$(\d+)/g, (_, n) => args[n - 1] || ''));
                    needTrim = true;
                }
                if (needTrim) {
                    replacement = replacement.trim();
                }
                matched = true;
                lastIndex = index + match.length;
                return match; // This return value is not used
            });
        
            // Add any remaining text
            newContent += content.slice(lastIndex);
            if (front.length > 0 || back.length > 0) {
                newContent = newContent.trim();
            }
            nextContentArray.push(front + newContent + back);
        }
        newContentArray = nextContentArray;
    }
    return newContentArray;
}

async function explorePageBlocksTree(tree, depth, config) {
    let result = [];
    let head = [];
    let tail = [];

    // Match all markdown images and replace with counter + format
    const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
    let listOfAssets = await logseq.Assets.listFilesOfCurrentGraph();

    let content = tree.content.replace(imageRegex, (match, alt, url) => {
        // Truncate URL to the last slash and check if it matches any asset
        const truncatedUrl = url.substring(url.lastIndexOf('/') + 1);
        const matchingAsset = listOfAssets.find(asset => asset.path.endsWith(truncatedUrl));
        if (matchingAsset) {
            url = matchingAsset.path; // Use the full matching asset path
        }
        url = url.replace(/\\/g, "/");
        return `\\begin{figure}[h!]\\centering\n\n\\includegraphics[width=0.7\\textwidth]{${url}}\n\\end{figure}`;
    });
    content = applyRegexRules(content, head, tail, config);

    let middle = [];
    let headForMiddle = [];
    let tailForMiddle = [];
    for (const child of tree.children) {
        middle.push(...await explorePageBlocksTree(child, depth + 1, config));
    }
    middle = applyContentRegexRules(middle, headForMiddle, tailForMiddle, config);

    if (tree.children.length != 0 && !content.endsWith("\\par")) {
        content += "\\par";
    }
    result.push(...head);
    result.push(content);
    result.push(...headForMiddle);
    result.push(...middle);
    result.push(...tailForMiddle);
    result.push(...tail);
    if (tree.children.length != 0 && !result[result.length - 1].endsWith("\\par")) {
        result[result.length - 1] += "\\par";
    }

    // Remove empty lines at the start and end of the result
    while (result.length > 0 && result[0].trim() === '') {
        result.shift();
    }
    while (result.length > 0 && result[result.length - 1].trim() === '') {
        result.pop();
    }

    return result;
}

async function removeEmptyLines(contentArray) {
    // Split the content array by newline characters
    const lines = contentArray.join('\n').split('\n');
    
    // Filter out empty lines
    const nonEmptyLines = lines.filter(line => line.trim() !== '');
    
    // Return the filtered array
    return nonEmptyLines;
}

async function removeNoParEnv(contentArray, config) {
    let result = [];
    let noPar = 0;
    for (const line of contentArray) {
        for (const env of config.noParEnv) {
            if (env.start.test(line)) {
                noPar++;
                break;
            }
        }
        if (noPar <= 0) {
            result.push(line);
        } else {
            result.push(line.replace(/\\par/g, ""));
        }
        
        for (const env of config.noParEnv) {
            if (env.end.test(line)) {
                noPar--;
                break;
            }
        }
    }
    return result;
}

async function removeDuplicatePar(contentArray) {
    let result = [];
    let str = contentArray.join('\n');
    str = str.replace(/\\par\s*\\par/g, "\\par\n");
    result = str.split('\n');
    return result;
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
    console.log("LogseqToLatex working...");
    let config = await reloadUserRules();
    let blocks = await logseq.Editor.getCurrentPageBlocksTree();
    let root = {children : blocks, content : ""};
    let contentArray = await explorePageBlocksTree(root, 0, config);


    contentArray = await removeDuplicatePar(contentArray);
    contentArray = await removeNoParEnv(contentArray, config);
    contentArray = await addLeadingTabs(contentArray, config);
    contentArray = await removeEmptyLines(contentArray);
    
    
    const currentPage = await logseq.Editor.getCurrentPage();
    const filename = `${currentPage.name}.tex`;
    saveToFile(contentArray.join('\n'), filename);
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
