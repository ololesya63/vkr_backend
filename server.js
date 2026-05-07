import express from "express";
import {parseWB} from "./parsers/wb.js";
import {parseOzon} from "./parsers/ozon.js";
import {groupWithOllama} from "./ollama/grouping.js";
import {parseOllamaGroups} from "./ollama/parseGroups.js";
import cors from "cors";
import {extractDynamicFilters, getWbFiltersViaSelenium} from "./parsers/wbFiltersParser.js";
import {getOzonFilterHeaders, getOzonFilterValues} from "./parsers/ozonFiltersParser.js";
import {ollama} from "./ollama/ollama.js";

const app = express();
app.use(cors());

// SSE-эндпоинт с передачей шагов
app.get("/goods-stream", async (req, res) => {
    const query = req.query.query;
    if (!query) {
        return res.status(400).json({error: "Нет query"});
    }
    console.log("📥 Получены параметры:", {
        query: req.query.query,
        minPrice: req.query.minPrice,
        maxPrice: req.query.maxPrice,
        platforms: req.query.platforms,
        highRating: req.query.highRating,
        original: req.query.original,
        premium: req.query.premium,
        sort: req.query.sort,
    });
    // Заголовки для Server-Sent Events
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
    });

    const sendStep = (step, message) => {
        res.write(`data: ${JSON.stringify({step, message})}\n\n`);
    };

    try {
        // Параметры фильтрации из строки запроса
        const minPrice = req.query.minPrice ? parseInt(req.query.minPrice) : undefined;
        const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice) : undefined;
        const highRating = req.query.highRating === 'true';
        const original = req.query.original === 'true';
        const premium = req.query.premium === 'true';
        const sort = req.query.sort || 'popular';   // пока не используется, но можно передать

        // Какие маркетплейсы включены (по умолчанию оба)
        const platformsParam = req.query.platforms || 'wb,ozon';
        const platformList = platformsParam.split(',');
        const enableWb = platformList.includes('wb');
        const enableOzon = platformList.includes('ozon');

        const filterOptions = {
            minPrice,
            maxPrice,
            highRating,
            isOriginal: original,
            premiumSeller: premium,
            sort,
            marketplaces: {wb: enableWb, ozon: enableOzon}
        };

        // Шаг 1: поиск на маркетплейсах
        sendStep(1, "Ищем товары на маркетплейсах");
        console.log('query value:', query, typeof query);
        // Параллельный запуск парсеров (только для выбранных площадок)
        const wbPromise = enableWb ? parseWB(query, filterOptions, 10) : Promise.resolve([]);
        const ozonPromise = enableOzon ? parseOzon(query, filterOptions, 10) : Promise.resolve([]);

        const [wbProducts, ozonProducts] = await Promise.all([wbPromise, ozonPromise]);

        // Шаг 2: сбор предложений
        sendStep(2, "Собираем предложения");
        const allProducts = [...wbProducts, ...ozonProducts];

        // Шаг 3: объединение и группировка
        sendStep(3, "Объединяем и группируем");
        const {raw, prepared} = await groupWithOllama(allProducts);
        const groups = parseOllamaGroups(raw, prepared);

        // Финальное событие с результатами
        res.write(`event: done\ndata: ${JSON.stringify(groups)}\n\n`);
        res.end();
    } catch (err) {
        console.error(err);
        res.write(`event: error\ndata: ${err.message}\n\n`);
        res.end();
    }
});

// Обычный REST-эндпоинт (для совместимости)
app.get("/goods", async (req, res) => {
    try {
        const query = req.query.query;
        if (!query) {
            return res.status(400).json({error: "Нет query"});
        }

        const minPrice = req.query.minPrice ? parseInt(req.query.minPrice) : undefined;
        const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice) : undefined;
        const highRating = req.query.highRating === 'true';
        const original = req.query.original === 'true';
        const premium = req.query.premium === 'true';
        const sort = req.query.sort || 'popular';

        const platformsParam = req.query.platforms || 'wb,ozon';
        const platformList = platformsParam.split(',');
        const enableWb = platformList.includes('wb');
        const enableOzon = platformList.includes('ozon');

        const filterOptions = {
            minPrice,
            maxPrice,
            highRating,
            isOriginal: original,
            premiumSeller: premium,
            sort,
            marketplaces: {wb: enableWb, ozon: enableOzon}
        };

        const wbPromise = enableWb ? parseWB(query, filterOptions, 10) : Promise.resolve([]);
        const ozonPromise = enableOzon ? parseOzon(query, filterOptions, 10) : Promise.resolve([]);

        const [wbProducts, ozonProducts] = await Promise.all([wbPromise, ozonPromise]);
        const allProducts = [...wbProducts, ...ozonProducts];

        const {raw, prepared} = await groupWithOllama(allProducts);
        const groups = parseOllamaGroups(raw, prepared);
        res.json(groups);
    } catch (e) {
        console.error(e);
        res.status(500).json({error: "Ошибка"});
    }
});

// Эндпоинт, возвращающий только группы с общими значениями
app.get("/dynamic-filters-final", async (req, res) => {
    const query = req.query.query;
    if (!query) return res.status(400).json({error: "Нет query"});

    let wbHeadersRaw = [];
    let ozonHeadersRaw = [];

    try {
        wbHeadersRaw = await getWbFiltersViaSelenium(query);
    } catch (err) {
        console.error("WB headers error", err);
    }
    try {
        ozonHeadersRaw = await getOzonFilterHeaders(query);
    } catch (err) {
        console.error("Ozon headers error", err);
    }

    const allHeaders = [...wbHeadersRaw, ...ozonHeadersRaw];
    if (!allHeaders.length) return res.json([]);

    // Создаём элементы с уникальными id
    const allItems = Object.fromEntries(
        allHeaders.map((h, idx) => ([
            idx+1,
            {
                name: h.name,
                platform: h.platform,
                original: h
            }
        ])));

    const input = Object.entries(allItems).map(([id, x]) => `${id} | ${x.platform} | ${x.name}`).join("\n");
    console.log("INPUT TO OLLAMA:\n", input);
    let groups = [];
    try {
        const response = await ollama.chat({
            model: "qwen3-vl:235b-cloud",
            messages: [
                {
                    role: "system",
                    content: `
Я передам тебе фильтры товаров из разных маркетплейсов.

Найди одинаковые по смыслу фильтры между маркетплейсами.

ПРАВИЛА:
- Каждая группа должна содержать РОВНО 2 ID
- В группе:
  - 1 ID от Wildberries
  - 1 ID от Ozon
- Выводи только реальные совпадения
- Если пары нет — не выводи ID
- Один ID можно использовать только 1 раз
- Не пиши пояснений
- Не добавляй текст

ФОРМАТ:

#1
1
4

#2
2
7
`
                },
                {
                    role: "user",
                    content: input
                }
            ]
        });

        const raw = response.message.content;
        console.log("Ollama response:\n", raw);

        const parsedGroups = raw
            .trim()
            .split("\n\n")
            .map((line) => line.split("\n").slice(1))
            .filter(Boolean);

        console.log("ГРУППЫ: ", parsedGroups)

        const filters = []

        for (const groupBlock of parsedGroups) {
            const wbFilter = allItems[groupBlock[0]]
            const ozonFilter = allItems[groupBlock[1]]

            filters.push({
                name: wbFilter.name,
                wb: wbFilter,
                ozon: ozonFilter,
            })
        }

        console.log("Фильтры: ", filters)
    } catch (err) {
        console.error("Ollama grouping error, using fallback", err);
        // fallback: группируем по имени (как было раньше)
        const byName = new Map();
        for (const item of allItems) {
            if (!byName.has(item.name)) byName.set(item.name, []);
            byName.get(item.name).push(item);
        }
        groups = Array.from(byName.values()).filter(g => g.length > 0);
    }

    // 3. Для каждой группы получить значения и найти пересечение
    const resultGroups = [];
    for (const groupItems of groups) {
        const wbItems = groupItems.filter(i => i.platform === 'wb');
        const ozonItems = groupItems.filter(i => i.platform === 'ozon');

        if (wbItems.length === 0 || ozonItems.length === 0) continue; // нет пары

        // Собираем значения для всех wb-фильтров группы (объединение)
        let wbValuesSet = new Set();
        for (const item of wbItems) {
            const values = await getWbFilterValues(query, item.original.key);
            values.forEach(v => wbValuesSet.add(v));
        }
        let ozonValuesSet = new Set();
        for (const item of ozonItems) {
            const values = await getOzonFilterValues(query, item.original.name);
            values.forEach(v => ozonValuesSet.add(v));
        }

        const common = [...wbValuesSet].filter(v => ozonValuesSet.has(v));
        if (common.length > 0) {
            // Имя группы: можно взять имя первого элемента
            resultGroups.push({
                groupName: groupItems[0].name,
                commonValues: common
            });
        }
    }

    res.json(resultGroups);
});

app.listen(3000, () => {
    console.log("🚀 Сервер запущен на http://localhost:3000");
});