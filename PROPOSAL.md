# MoonBit IMAP4 会话与客户端 · 项目申报书

## 一、项目名称

MoonBit IMAP4 会话与客户端

## 二、项目说明

MoonBit 实现字节精确响应解析、literal、continuation 和会话；Node 宿主提供 TCP、隐式 TLS、STARTTLS、取消和超时。二进制邮件不经文本解码器。

## 三、方向与通用性

基础软件与邮件协议。用于邮箱巡检、邮件夹操作和通知接入；不将单服务器互通推断为所有 IMAP 扩展兼容。

## 四、应用场景

只读 SELECT 配合 BODY.PEEK 获取头部；APPEND 等待 continuation 后上传正文；IDLE 接收通知并显式退出；中文邮件夹通过 modified UTF-7 编解码。

## 五、功能与验证边界

支持列明的 FETCH/SEARCH/STORE/COPY/MOVE、UID、APPEND、IDLE 等路径，TLS 拒绝后不降级。literal、语法和会话有界；Dovecot 等独立互通记录与回环夹具分列，长期运行及 Cyrus 兼容尚未验证。

## 六、原创性与参考材料

原创代码 MIT。依据 RFC 3501 等规范及 go-imap（MIT，https://github.com/emersion/go-imap）公开行为独立实现。Dovecot（按文件为 LGPL-2.1/MIT 等，https://github.com/dovecot/core/blob/main/COPYING）和 GreenMail 只作独立测试依赖，不随源码分发。

## 七、仓库链接

https://github.com/huanglong44/moonbit-imap
