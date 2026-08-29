const TYPE_LABELS = {
    stat: "词缀",
    item: "物品",
    static: "静态",
    filter: "筛选器",
    property: "属性",
    ui: "界面文字",
};
let records = [];
let overrideCount = 0;
const list = document.querySelector("#records");
const empty = document.querySelector("#empty");
const status = document.querySelector("#status");
const template = document.querySelector("#record-template");
const search = document.querySelector("#search");
const typeFilter = document.querySelector("#type-filter");
const showIgnored = document.querySelector("#show-ignored");
const reconnect = document.querySelector("#reconnect");
function unavailableMessage() {
    return location.protocol === "chrome-extension:"
        ? "扩展刚刚被刷新，此管理页的连接已经失效。请点击“重新连接扩展”。"
        : "这是静态预览页面，无法访问扩展数据。请从浏览器工具栏中的插件打开“漏译管理”。";
}
async function send(message) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage)
        throw new Error(unavailableMessage());
    let response;
    try {
        response = await runtime.sendMessage(message);
    }
    catch (error) {
        if (!globalThis.chrome?.runtime?.sendMessage || /context invalidated/i.test(error?.message)) {
            throw new Error(unavailableMessage());
        }
        throw error;
    }
    if (!response?.ok)
        throw new Error(response?.message || "操作失败");
    return response;
}
function showLoadError(error) {
    status.textContent = error.message;
    reconnect.hidden = location.protocol !== "chrome-extension:";
}
function updateSummary() {
    document.querySelector("#pending-count").textContent = records.filter((r) => !r.ignored).length;
    document.querySelector("#ignored-count").textContent = records.filter((r) => r.ignored).length;
    document.querySelector("#override-count").textContent = overrideCount;
}
function filteredRecords() {
    const query = search.value.trim().toLowerCase();
    return records.filter((record) => {
        if (!showIgnored.checked && record.ignored)
            return false;
        if (typeFilter.value && record.type !== typeFilter.value)
            return false;
        return !query || `${record.key} ${record.en}`.toLowerCase().includes(query);
    });
}
function render() {
    list.replaceChildren();
    const visible = filteredRecords().slice(0, 500);
    empty.hidden = visible.length > 0;
    for (const record of visible) {
        const node = template.content.firstElementChild.cloneNode(true);
        node.classList.toggle("ignored", record.ignored);
        node.querySelector(".type").textContent = TYPE_LABELS[record.type] ?? record.type;
        node.querySelector(".key").textContent = record.key;
        node.querySelector(".count").textContent = `发现 ${record.seenCount} 次`;
        node.querySelector(".english").textContent = record.en;
        node.querySelector(".meta").textContent = [
            record.context && `来源：${record.context}`,
            record.datasetVersion && `词库：${record.datasetVersion}`,
            record.lastSeen && `最近：${new Date(record.lastSeen).toLocaleString()}`,
        ].filter(Boolean).join(" · ");
        const input = node.querySelector(".translation");
        node.querySelector(".save").addEventListener("click", async (event) => {
            event.currentTarget.disabled = true;
            try {
                const result = await send({
                    type: "POE2ZH_SAVE_OVERRIDE",
                    payload: { ...record, translation: input.value },
                });
                status.textContent = result.message;
                await load();
            }
            catch (error) {
                status.textContent = error.message;
            }
            finally {
                event.currentTarget.disabled = false;
            }
        });
        const ignore = node.querySelector(".ignore");
        ignore.textContent = record.ignored ? "取消忽略" : "忽略";
        ignore.addEventListener("click", async () => {
            await send({ type: "POE2ZH_IGNORE_MISSING", id: record.id, ignored: !record.ignored });
            await load();
        });
        node.querySelector(".delete").addEventListener("click", async () => {
            await send({ type: "POE2ZH_DELETE_MISSING", id: record.id });
            await load();
        });
        list.append(node);
    }
    updateSummary();
}
async function load() {
    const result = await send({ type: "POE2ZH_GET_HEALTH" });
    records = result.records;
    overrideCount = result.overrideCount;
    render();
}
function exportReport() {
    const safeRecords = records.map(({ type, key, en, context, datasetVersion, firstSeen, lastSeen, seenCount }) => ({
        type,
        key,
        en,
        context,
        datasetVersion,
        firstSeen,
        lastSeen,
        seenCount,
    }));
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records: safeRecords }, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `poe2zh-missing-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(href);
}
search.addEventListener("input", render);
typeFilter.addEventListener("change", render);
showIgnored.addEventListener("change", render);
document.querySelector("#export").addEventListener("click", exportReport);
document.querySelector("#clear").addEventListener("click", async () => {
    if (!confirm("确定清空全部漏译记录吗？本地修正不会被删除。"))
        return;
    await send({ type: "POE2ZH_CLEAR_MISSING" });
    status.textContent = "漏译记录已清空";
    await load();
});
reconnect.addEventListener("click", () => location.reload());
load().catch(showLoadError);
