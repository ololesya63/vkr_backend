import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const randomSleep = async (min = 800, max = 1500) => {
    await new Promise(r => setTimeout(r, Math.random() * (max - min) + min));
};

async function createDriver() {
    const options = new chrome.Options();
    options.addArguments(
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--lang=ru-RU',
        '--log-level=3',
        '--silent',
    );
    options.addArguments('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    options.excludeSwitches(['enable-automation']);

    return await new Builder().forBrowser('chrome').setChromeOptions(options).build();
}

export async function createOzonDriver() {
    return await createDriver();
}

const EXCLUDE_NAMES = new Set([
    'Цена', 'Распродажа', 'Оригинальный товар', 'Официальные магазины бренда',
    'Рассрочка', 'Баллы за отзывы', 'Сделано в России', 'Больше морковок от Захара',
    'Доставка', 'Рассрочка 0-0-6', 'Высокий рейтинг', 'Уцененный товар',
    'Товары со скидкой', 'Товары Premium продавцов', 'Бестселлеры', 'Новинки', 'Магазин'
]);

export async function getOzonFilters(query, driver = null) {
    const ownDriver = !driver;
    if (ownDriver) driver = await createDriver();
    const results = [];

    try {
        // Ищем через строку поиска, как реальный пользователь
        await driver.get('https://www.ozon.ru');
        await randomSleep(2000, 4000);
        const input = await driver.wait(until.elementLocated(By.css('input[name="text"]')), 15000);
        await input.click();
        await randomSleep(300, 700);
        await input.sendKeys(query);
        await randomSleep(500, 1200);
        const searchBtn = await driver.findElement(By.css('button[type="submit"]'));
        await searchBtn.click();
        await randomSleep(4000, 6000);

        // Ждём появления блока фильтров на странице результатов
        await driver.wait(until.elementLocated(By.css('[data-widget="filtersDesktop"]')), 20000);
        await randomSleep(1000, 2000);

        // Кликаем "Все фильтры" внутри блока фильтров
        const filtersWidget = await driver.findElement(By.css('[data-widget="filtersDesktop"]'));
        const btn = await filtersWidget.findElement(By.css('button.b25_8_3-a4'));
        await driver.executeScript('arguments[0].click()', btn);
        await randomSleep(1500, 2500);

        // Ждём панель
        await driver.wait(until.elementLocated(By.css('.gc7_7')), 10000);
        await randomSleep(1000, 1500);

        // Раскрываем все expandable фильтры сразу через JS
        await driver.executeScript(() => {
            for (const row of document.querySelectorAll('.cg8_7')) {
                const header = row.querySelector('.g5c_7');
                if (header) header.click();
            }
        });
        await randomSleep(2000, 3000);

        // Теперь читаем все фильтры — DOM уже не будет меняться
        const parsed = await driver.executeScript(() => {
            const result = [];
            for (const row of document.querySelectorAll('.cg8_7')) {
                if (!row.querySelector('.g5c_7')) continue;
                const nameEl = row.querySelector('.gc5_7 span');
                if (!nameEl) continue;
                const name = nameEl.innerText.replace(/\s+/g, ' ').trim();
                if (!name) continue;
                const container = row.querySelector('.g6c_7');
                if (!container) continue;
                const inputs = container.querySelectorAll('input[type="range"]');
                if (inputs.length > 0) {
                    result.push({ name, values: [inputs[0].min, inputs[0].max] });
                    continue;
                }
                const hasSwatch = !!container.querySelector('.b4x_7');
                if (hasSwatch) {
                    result.push({ name, values: [], hasSwatch: true });
                    continue;
                }
                const spans = container.querySelectorAll('span.tsBody500Medium');
                const values = Array.from(spans).map(s => s.innerText.trim()).filter(Boolean);
                if (values.length > 0) result.push({ name, values });
            }
            return result;
        });

        for (const { name, values, hasSwatch } of parsed) {
            try {
                if (name.length < 2 || name.length > 60 || EXCLUDE_NAMES.has(name)) continue;

                let finalValues = values;

                if (hasSwatch) {
                    // Для цветов нужен hover — ищем свотчи заново
                    finalValues = [];
                    const swatchEls = await driver.findElements(By.css('.b4x_7'));
                    for (const swatch of swatchEls) {
                        try {
                            await driver.actions().move({ origin: swatch }).perform();
                            await driver.sleep(400);
                            let text = null;
                            try {
                                const tooltip = await driver.findElement(By.css('.ea5_3_23-a6 .ea5_3_23-a8.ea5_3_23-a5'));
                                text = await tooltip.getText();
                            } catch {
                                try {
                                    const tooltip = await driver.findElement(By.css('.ea5_3_23-a6'));
                                    text = await tooltip.getText();
                                } catch {}
                            }
                            if (text?.trim()) finalValues.push(text.trim());
                            await driver.actions().move({ x: 0, y: 0 }).perform();
                            await driver.sleep(150);
                        } catch {}
                    }
                    finalValues = [...new Set(finalValues)];
                }

                if (finalValues.length > 0) {
                    results.push({
                        name,
                        key: name.toLowerCase().replace(/\s+/g, '_'),
                        platform: 'ozon',
                        values: finalValues
                    });
                    console.log(`[Ozon] ${name} (${finalValues.length}): ${finalValues.slice(0, 8).join(', ')}`);
                }
            } catch (e) {
                console.error(`[Ozon] Ошибка фильтра:`, e.message);
            }
        }

        return results;
    } finally {
        if (ownDriver) await driver.quit();
    }
}
