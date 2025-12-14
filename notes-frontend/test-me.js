
const MindElixir = require('mind-elixir');
console.log('MindElixir:', MindElixir);
console.log('MindElixir.default:', MindElixir.default);
try {
    console.log('MindElixir.new:', MindElixir.new('test'));
} catch (e) {
    console.log('MindElixir.new error:', e.message);
}
try {
    console.log('MindElixir.default.new:', MindElixir.default.new('test'));
} catch (e) {
    console.log('MindElixir.default.new error:', e.message);
}
