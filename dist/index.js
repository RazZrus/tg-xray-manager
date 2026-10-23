"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_js_1 = require("./config.js");
const wizard_js_1 = require("./wizard.js");
const bot_js_1 = require("./bot.js");
async function main() {
    if (!(0, config_js_1.configExists)()) {
        await (0, wizard_js_1.runWizard)();
    }
    await (0, bot_js_1.startBot)();
}
main().catch((err) => {
    console.error('Критическая ошибка:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map