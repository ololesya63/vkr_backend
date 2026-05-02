export function parseOllamaGroups(text, prepared) {
    const map = new Map(
        prepared.map(p => [String(p.id), p.product])
    );

    const groups = [];
    let current = [];

    for (const line of text.split("\n")) {
        const v = line.trim();

        if (!v) continue;

        if (v.startsWith("#")) {
            if (current.length) groups.push(current);
            current = [];
        } else {
            const product = map.get(v);
            if (product) current.push(product);
        }
    }

    if (current.length) groups.push(current);

    return groups;
}
