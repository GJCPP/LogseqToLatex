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
                lineBeginning: rule.lineBeginning,
                lineEnd: rule.lineEnd,
                overwrite: rule.overwrite
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
    let groupOfRules = config.number_list_rules;
    let contentRules = [];
    for (const ruleGroup in groupOfRules) {
        for (const rule of groupOfRules[ruleGroup]) {
            contentRules.push({
                trigger: new RegExp(`${rule.trigger}`, 'g'),
                repl: rule.replacement,
                head: rule.head,
                tail: rule.tail,
                lineBeginning: rule.lineBeginning,
                lineEnd: rule.lineEnd,
                overwrite: rule.overwrite
            });
        }
    }
    return { regexRules: ret, numberListRule: contentRules, noIndentEnv: noIndentEnv, noParEnv: noParEnv, protectEnv: protectEnv };
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
    for (const env of config.protectEnv) { // Enumerate all the protected environments
        content.replace(env.range, (match, ...args) => { // This is a lambda function that is called for each match of the regex and return the content to replace the match.
            const index = args[args.length - 2];
            const length = match.length;
            if (isProtected(index, length, protectedRanges)) {
                return match; // Keep the match unchanged if it's protected
            }
            protectedRanges.push({ start: index, end: index + length });
            return match; // Keep the match unchanged in the content
        });
    }
    return protectedRanges;
}

function isProtected(index, length, protectedRanges) {
    for (const range of protectedRanges) {
        if (!(index >= range.end || index + length <= range.start)) {
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
        } else if (match = matchNonProtected(/\\begin\{.*?\}/, line, protectedRanges)) {
            // Check if we can find the corresponding \end{...}
            const beginMatch = match[0];
            const envName = beginMatch.match(/\\begin\{(.*?)\}/)[1];
            const endPattern = new RegExp(`\\\\end\\{${envName}\\}`);
            const hasMatchingEnd = endPattern.test(contentArray[i]);

            result.push("\t".repeat(noIndent <= 0 ? indent : 0) + `${line}`);

            if (!hasMatchingEnd) {
                // If no matching \end{...} is found, increase indent
                indent++;
            }
        } else if (match = matchNonProtected(/\\end\{.*?\}/, line, protectedRanges)) {
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

    const protectedRanges = getProtectedRanges(content, config); // Some content are protected from being modified, including mathmode formulas, codeblocks, etc.  This function returns an array of objects, each object represents a protected range.

    for (const rule of config.regexRules) {
        let lineFront = ""; // The content that should be added at the beginning of the current line
        let lineBack = "";  // The content that should be added at the end of the current line
        let lastIndex = 0;
        let newContent = '';
        content.replace(rule.trigger, (match, ...args) => {
            // console.log("content", content);
            // console.log("match", match);
            const index = args[args.length - 2];

            // Check if the current match is within any protected range
            const isProtectedRange = isProtected(index, match.length, protectedRanges);

            if (isProtectedRange && !rule.overwrite) {
                // If the content is protected and the protection is not overwritten, don't apply the rule
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
            if (rule.lineBeginning && rule.lineBeginning.length > 0) {
                lineFront += rule.lineBeginning.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
            }
            if (rule.lineEnd && rule.lineEnd.length > 0) {
                lineBack += rule.lineEnd.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
            }
            newContent += replacement;
            lastIndex = index + match.length;
            
            return match; // This return value is not used
        });
        
        // Add any remaining text
        newContent += content.slice(lastIndex);
        if (lineFront.length > 0 || lineBack.length > 0) {
            newContent = newContent.trim();
        }
        content = lineFront + newContent + lineBack;
    }
    return content;
}

function parseNumberedList(contentArray, head, tail, config) {

    // Parse numbered list in Logseq to enumeration in LaTeX

    let newContentArray = [];
    for (const rule of config.numberListRule) {
        let matched = false;
        for (const content of contentArray) {
            let lineFront = ""; // The content that should be added at the beginning of each line
            let lineBack = "";  // The content that should be added at the end of each line
            let lastIndex = 0; // The index of last match
            let newContent = ''; // The new content after applying the rule
            let protectedRanges = getProtectedRanges(content, config); // Some content are protected from being modified, including mathmode formulas, codeblocks, etc.
            content.replace(rule.trigger, (match, ...args) => {
                const index = args[args.length - 2];
                newContent += content.slice(lastIndex, index);
                // Check if the current match is within any protected range
                const isProtectedRange = isProtected(index, match.length, protectedRanges);
                // If protected, don't apply the rule
                if (isProtectedRange && !rule.overwrite) {
                    newContent += content.slice(index, index + match.length);
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
                
                if (rule.lineBeginning && rule.lineBeginning.length > 0) {
                    lineFront += rule.lineBeginning.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
                }
                if (rule.lineEnd && rule.lineEnd.length > 0) {
                    lineBack += rule.lineEnd.replace(/\$(\d+)/g, (_, n) => args[n - 1] || '');
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
                newContent += replacement;
                matched = true;
                lastIndex = index + match.length;
                return match; // This return value is not used
            });
        
            // Add any remaining text
            newContent += content.slice(lastIndex);
            if (lineFront.length > 0 || lineBack.length > 0) {
                newContent = newContent.trim();
            }
            newContentArray.push(lineFront + newContent + lineBack);
        }
        
        // Only update contentArray if a match was found
        if (matched) {
            contentArray = newContentArray;
            newContentArray = [];
        }
    }
    return contentArray;
}

async function explorePageBlocksTree(tree, depth, config) { // Blocks of Logseq are organized in a tree structure. This function recursively explores the tree and converts each block to LaTeX.
    let result = [];
    let head = []; // Head is the content that should be added before the current block, e.g. "\begin{enumerate}"
    let tail = []; // Tail is the content that should be added after the current block, e.g. "\end{enumerate}"

    // Handle images by replacing them with LaTeX figure environments

    const imageRegex = /!\[(.*?)\]\((.*?)\)/g; // Match all markdown images and replace with counter + format
    let listOfAssets = await logseq.Assets.listFilesOfCurrentGraph(); // Get the list of assets in the current graph

    let content = tree.content.replace(imageRegex, (match, alt, url) => {
        // In Logseq, the URL of an image is the relative path, e.g. "../assets/image1.png".
        // However, the LaTeX figure environment requires the full path, e.g. "/Users/username/Documents/logseq/assets/image1.png".


        // Step 1. Truncate URL to the last slash to obtain the filename.
        // For example, "../assets/2021-01-01.png" would be truncated to "2021-01-01.png"
        const truncatedUrl = url.substring(url.lastIndexOf('/') + 1);

        const matchingAsset = listOfAssets.find(asset => asset.path.endsWith(truncatedUrl)); // Find the asset with the matching path.
        
        if (matchingAsset) {
            url = matchingAsset.path; // Use the full matching asset path
        }
        url = url.replace(/\\/g, "/");
        return `\\begin{figure}[h!]\\centering\n\n\\includegraphics[width=0.7\\textwidth]{${url}}\n\\end{figure}`;
    });

    // Empty blocks would be converted to the new paragraph command \par.
    
    if (content == "") {
        content = "\\par";
    }

    // Step 2. Apply regex rules to the content.

    content = applyRegexRules(content, head, tail, config);

    let middle = [];
    let headForMiddle = [];
    let tailForMiddle = [];
    for (const child of tree.children) {
        middle.push(...await explorePageBlocksTree(child, depth + 1, config));
    }
    middle = parseNumberedList(middle, headForMiddle, tailForMiddle, config);


    if (tree.children.length != 0 && !content.endsWith("\\par") && !content.endsWith("}")) {
        // content += "\\par";
    }
    result.push(...head);
    result.push(content);
    result.push(...headForMiddle);
    result.push(...middle);
    result.push(...tailForMiddle);
    result.push(...tail);
    if (tree.children.length != 0 && !result[result.length - 1].endsWith("\\par") && !result[result.length - 1].endsWith("}")) {
        // result[result.length - 1] += "\\par";
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
    str = str.replace(/\\par\s*\\par/g, "\\par\n"); // Two \par in a row are replaced by one \par
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

    // Step 1. Get the blocks of the current page and convert them into latex code.

    let blocks = await logseq.Editor.getCurrentPageBlocksTree();
    let root = {children : blocks, content : ""};
    let contentArray = await explorePageBlocksTree(root, 0, config); // contentArray is an array of strings, each string is a line of LaTeX code.

    // Step 2. Deal with certain special formats, such as indentation, tags, collapsed, etc.

    contentArray = await removeDuplicatePar(contentArray); // Remove duplicate \par
    contentArray = await removeNoParEnv(contentArray, config); // Remove \par in no_par_env, e.g. in enumerate or itemize
    contentArray = await addLeadingTabs(contentArray, config); // Add indentation of sections, subsections, etc.
    contentArray = await removeEmptyLines(contentArray);    // Remove empty lines in markdown
    
    // Step 3. Save the contentArray to a .tex file.

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
