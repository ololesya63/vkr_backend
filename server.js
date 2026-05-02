import express from "express";
import { parseWB } from "./parsers/wb.js";
import { parseOzon } from "./parsers/ozon.js";
import { groupWithOllama } from "./ollama/grouping.js";
import { parseOllamaGroups } from "./ollama/parseGroups.js";
import cors from "cors";

const app = express();
app.use(cors());

// SSE-эндпоинт с передачей шагов
app.get("/goods-stream", async (req, res) => {
    const query = req.query.query;
    if (!query) {
        return res.status(400).json({ error: "Нет query" });
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
        res.write(`data: ${JSON.stringify({ step, message })}\n\n`);
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
            marketplaces: { wb: enableWb, ozon: enableOzon }
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
        const { raw, prepared } = await groupWithOllama(allProducts);
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
            return res.status(400).json({ error: "Нет query" });
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
            marketplaces: { wb: enableWb, ozon: enableOzon }
        };

        const wbPromise = enableWb ? parseWB(query, filterOptions, 10) : Promise.resolve([]);
        const ozonPromise = enableOzon ? parseOzon(query, filterOptions, 10) : Promise.resolve([]);

        const [wbProducts, ozonProducts] = await Promise.all([wbPromise, ozonPromise]);
        const allProducts = [...wbProducts, ...ozonProducts];

        const { raw, prepared } = await groupWithOllama(allProducts);
        const groups = parseOllamaGroups(raw, prepared);
        res.json(groups);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Ошибка" });
    }
});

app.listen(3000, () => {
    console.log("🚀 Сервер запущен на http://localhost:3000");
});