import { getAllStocks, removeStock } from '../server/services/dataStore.js';

async function cleanup() {
    console.log("Starting forced cleanup...");
    removeStock('PSRAJ-SM');
    removeStock('PSRAJ');
    console.log("Cleanup complete.");
}
cleanup();
