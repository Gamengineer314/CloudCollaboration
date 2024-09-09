/**
 * @brief Check if a file name matches a given array of rules
 * @param name Name of the file
 * @param rules List of rules
**/
export function match(name: string, rules: string[]) : boolean {
    let match = false;
    name = name.substring(1);
    for (let rule of rules) {
        const negate = rule.startsWith("!");
        if (negate) {
            rule = rule.substring(1);
        }

        if (match === negate) {
            if (matchRule(name, rule)) {
                match = !match;
            }
        }
    }
    return match;
}


/**
 * @brief Check if a file name matches a given rule
 * @param name Name of the file
 * @param rule Rule to match
**/
function matchRule(name: string, rule: string, nameIndex: number = 0, ruleIndex: number = 0) : boolean {
    // End
    if (nameIndex === name.length && ruleIndex === rule.length) {
        return true;
    }
    else if (nameIndex === name.length || ruleIndex === rule.length) {
        return false;
    }

    // Current character
    if (name[nameIndex] === rule[ruleIndex] || rule[ruleIndex] === "?") {
        return matchRule(name, rule, nameIndex + 1, ruleIndex + 1);
    }

    // Range
    if (rule[ruleIndex] === "[") {
        for (let i = ruleIndex + 1; rule[i] !== "]"; i++) {
            if (rule[i] === name[nameIndex]) {
                for (; rule[i] !== "]"; i++) {}
                return matchRule(name, rule, nameIndex + 1, i + 1);
            }
        }
        return false;
    }

    // *, **
    if (rule[ruleIndex] === "*") {
        const double = ruleIndex + 1 < rule.length && rule[ruleIndex + 1] === "*";
        if (matchRule(name, rule, nameIndex + 1, ruleIndex + (double ? 2 : 1))) {
            return true;
        }
        else if (double || name[nameIndex] !== "/") {
            if (matchRule(name, rule, nameIndex + 1, ruleIndex)) {
                return true;
            }
        }
        return false;
    }

    return false;
}