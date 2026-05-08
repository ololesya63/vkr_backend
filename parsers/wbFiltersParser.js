import chrome from "selenium-webdriver/chrome.js";
import {Builder, By, until} from "selenium-webdriver";


export async function getWbFiltersViaSelenium(query) {
    const options = new chrome.Options();
    options.addArguments(
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,900",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    );
    const driver = await new Builder().forBrowser("chrome")
        .setChromeOptions(options/*.addArguments("--headless")*/)
        .build();

    try {
        const url = `https://www.wildberries.ru/__internal/search/exactmatch/ru/common/v18/search?curr=rub&dest=-3224247&lang=ru&locale=ru&query=${encodeURIComponent(query)}&resultset=filters&scale=5&spp=30&suppressSpellcheck=false&uclusters=4`;
        await driver.get(url);
        console.log("открываем браузер")

        console.log("Открыли страницу");

        // Ждём появления <pre>
        await driver.wait(
            until.elementLocated(By.css("pre")),
            10000
        );

        console.log("<pre> найден");

        // Ждём, пока загрузится контейнер с фильтрами (или любая другая проверка)
        const filtersData = await driver.executeScript(() => {
            const pre = document.getElementsByTagName("pre")[0];
            if (pre) {
                return JSON.parse(pre.innerText);
            }

            return null;
        });
        console.log("JSON:")
        console.log(filtersData)
        if (filtersData && filtersData.data && filtersData.data.filters) {
            // Успешно нашли массив фильтров
            return extractDynamicFilters(filtersData.data.filters);
        } else {
            console.warn("Не удалось извлечь фильтры WB через Selenium");
            return [];
        }
    } catch (err) {
        console.error("Ошибка в getWbFiltersViaSelenium:", err);
        return [];
    } finally {
        await driver.quit();
    }
}

export function extractDynamicFilters(filtersArray) {
    // Ключи базовых фильтров, которые уже есть в нашем UI (не показываем как динамические)
    const excludeKeys = [
        'faction',      // Распродажа
        'fnds',         // Можно вернуть НДС
        'priceU',       // Цена
        'fdlvr',        // Срок доставки
        'frating',      // Рейтинг от 4,7
        'foriginal',    // Оригинал
        'fpremium',     // Премиум-продавец
        'ffeedbackpoints', // Баллы за отзыв
        'fcashback',    // Кешбэк
        'fpremiumuser', // Скидки WB Клуба
        'fc2c',         // Ресейл
        'fvideo',       // Видео
        'fcrossborder', // Товары из-за рубежа
        'fqtydiscount', // Оптом дешевле
        'fdtype'
    ];

    const result = [];

    for (const filter of filtersArray) {
        if (excludeKeys.includes(filter.key)) continue;

        const hasItems = filter.items && Array.isArray(filter.items) && filter.items.length > 0;
        const hasRange = filter.from !== undefined && filter.to !== undefined;
        if (!hasItems && !hasRange) continue;

        result.push({
            ...filter,
            platform: 'wb',
        });
    }

    return result;
}

export function getWbFilterValues(filterHeader) {
    if (filterHeader.from !== undefined && filterHeader.to !== undefined) {
        return [String(filterHeader.from), String(filterHeader.to)];
    }
    return (filterHeader.items || []).map(i => i.name?.trim()).filter(Boolean);
}
