-- 按设备保存的用户设置。
--
-- 背景：主题 / 语言 / 朗读音色原本存在 config 表（全局单份），
-- 于是电子阅读器和 iPad 只能共用一套设置。本表按 device_id 分桶保存，
-- 查询时「设备值优先、全局值兜底」，因此未设置过的设备行为完全不变。
--
-- device_id 由客户端生成（localStorage 中的 UUID）并随 X-Device-Id 头发送，
-- 单用户应用下它只是「同一用户的另一台设备」，不承担鉴权作用。
CREATE TABLE device_settings (
    device_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (device_id, key)
);

-- 已知设备清单：仅用于让设备「出现」在库里（便于日后排查/管理），
-- 以及记录最后活跃时间。当前产品无界面，纯后台维护。
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
