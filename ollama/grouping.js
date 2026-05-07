import { ollama } from "./ollama.js";

export async function groupWithOllama(products) {
    const prepared = products.map((product, index) => ({
        id: index + 1,
        product
    }))
    const input = prepared
        .map(p => `${p.id} | ${p.product.title || p.product.name}`)
        .join("\n");


    const response = await ollama.chat({
        model: "qwen3-vl:235b-cloud",
        messages: [
            {
                role: "system",
                content: `
Я передам тебе строки с названиями товаров на маркетплейсе, сгруппируй одинаковые товары, обращай внимание на ключевые слова, а не на совпадение названий в целом.
- Используй только id
- Не пиши пояснений
- Не добавляй текст
- Один товар — в одной группе

ФОРМАТ:
#1
id
id

#2
id
`
            },
            {
                role: "user",
                content: input
            }
        ]
    });

    return {
        raw: response.message.content,
        prepared
    };
}
