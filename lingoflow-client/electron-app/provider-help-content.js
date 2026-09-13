(function (root) {
  "use strict";

  root.PROVIDER_HELP_CONTENT = Object.freeze({
    defaultTopic: "openai-compatible",
    topics: Object.freeze({
      "openai-compatible": Object.freeze({
        title: "通用模型服务",
        what: "不同模型服务商可以使用相近的连接方式。你只需选择服务商，并确认接口地址、API 密钥和模型是否正确。官方列表只是常用模板，不在列表里的平台，也可以通过“自定义”正常使用。",
        example: "选择 DeepSeek 后，软件会自动带入接口地址 https://api.deepseek.com/v1 和模型 deepseek-v4-flash。",
        howTo: Object.freeze([
          "打开你准备使用的模型服务商网站。",
          "在开发者文档中确认它提供通用对话接口；文档有时会写“兼容 OpenAI”。",
          "从控制台取得接口地址、API 密钥和可用模型名称。"
        ]),
        note: "连接成功表示软件可以访问该服务。能否正常翻译还取决于密钥额度、模型权限和服务状态。",
        links: Object.freeze([])
      }),
      "custom-provider": Object.freeze({
        title: "自定义服务商",
        what: "当列表里没有你要使用的服务商时，可以选择“自定义”，手动填写它的接口地址、API 密钥和模型。翻译方式不会因此改变。",
        example: "例如手动配置 DeepSeek：接口地址填写 https://api.deepseek.com/v1，模型填写 deepseek-v4-flash，再填写自己的 API 密钥。",
        howTo: Object.freeze([
          "在“服务商”中选择“自定义”。",
          "展开高级选项，从服务商文档复制接口地址和模型名称。",
          "填写 API 密钥，保存配置，再点击“连接”进行确认。"
        ]),
        note: "不要填写网页聊天页面的网址。这里需要服务商提供给程序调用的接口地址。",
        links: Object.freeze([])
      }),
      "base-url": Object.freeze({
        title: "接口地址",
        what: "接口地址告诉软件把翻译请求发送到哪里。它不是服务商首页，也不是网页聊天页面的网址。",
        example: "DeepSeek 的接口地址示例是 https://api.deepseek.com/v1。其他服务商的地址可能不同。",
        howTo: Object.freeze([
          "打开服务商的开发者文档或接入说明。",
          "查找“接口地址”“请求地址”或“Base URL”。",
          "复制完整地址，并保留文档要求的 /v1 等结尾。"
        ]),
        note: "不要自行添加 /chat/completions。优先使用 https:// 地址；只有本机服务通常会使用 http://localhost。",
        links: Object.freeze([])
      }),
      "api-key": Object.freeze({
        title: "API 密钥",
        what: "API 密钥相当于模型服务的访问密码，用来确认你的账号有权调用该服务。软件只把它保存在本机。",
        example: "DeepSeek 的 API 密钥通常是一串以 sk- 开头的字符，例如 sk-••••••••。请填写你自己创建的真实密钥。",
        howTo: Object.freeze([
          "登录你选择的模型服务商控制台。",
          "找到“API 密钥”“密钥管理”或“开发者密钥”页面。",
          "复制后立即保存到本配置；多数平台不会再次显示完整密钥。"
        ]),
        note: "不要在截图、日志或公开问题中展示密钥。编辑已有配置时留空会继续使用已保存密钥；不需要密钥的本机服务可按文档留空。",
        links: Object.freeze([])
      }),
      model: Object.freeze({
        title: "模型",
        what: "模型决定实际负责翻译的是哪一个模型。这里需要填写服务商允许程序调用的准确名称。",
        example: "DeepSeek 当前预设使用 deepseek-v4-flash。请以你的 DeepSeek 控制台实际可用模型为准。",
        howTo: Object.freeze([
          "打开服务商的模型列表或开发者文档。",
          "找到可调用模型的准确名称并完整复制。",
          "确认该模型对你的账号和 API 密钥开放。"
        ]),
        note: "模型名称可能区分大小写，也可能包含版本后缀。不要照抄帮助中的示例，以服务商当前控制台为准。",
        links: Object.freeze([])
      })
    }),
    reservedSections: Object.freeze(["headers", "timeout", "capabilities", "faq", "officialLinks"])
  });
})(window);
