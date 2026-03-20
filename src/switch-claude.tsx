import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Color,
  useNavigation,
  showToast,
  showHUD,
  Toast,
  confirmAlert,
  Alert,
  LocalStorage,
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { getSettingsStatus, readCurrentConfig, scanProfiles, profileExists } from "./utils/config";
import { switchProfile } from "./utils/switch";
import { writeProfile, updateModel, updateProfile, deleteProfile, initializeFromExisting, buildProfileConfig } from "./utils/file";
import { testConnectivity } from "./utils/connectivity";
import { exportProfile, parseImportJson } from "./utils/transfer";
import { getNameError, getUrlError } from "./utils/validate";
import { PROVIDER_TEMPLATES } from "./constants";
import type { Profile, ProfileConfig, ConnectivityStatus } from "./types";

// ─── 工具函数 ───────────────────────────────────────────────

function maskApiKey(key: string): string {
  if (!key) return "—";
  if (key.length <= 8) return key;
  return key.slice(0, 8) + "...";
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.message.includes("ENOENT")) return "配置文件不存在，请重新创建";
    if (e.message.includes("EACCES")) return "没有权限修改文件，请检查 ~/.claude 目录权限";
    if (e.message.includes("EEXIST")) return "配置名称已存在，请使用其他名称";
    if (e.message.includes("SyntaxError") || e.message.includes("JSON")) return "配置文件格式损坏";
    return e.message;
  }
  return "未知错误";
}

// ─── 初始化向导 ─────────────────────────────────────────────

function InitWizard({
  currentConfig,
  onSuccess,
}: {
  currentConfig: ProfileConfig | null;
  onSuccess: () => void;
}) {
  const [nameError, setNameError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { name: string }) {
    const err = getNameError(values.name);
    if (err) { setNameError(err); return; }

    setIsLoading(true);
    try {
      const config: ProfileConfig = currentConfig ?? buildProfileConfig("", "", "");
      initializeFromExisting(values.name, config);
      await showToast({ style: Toast.Style.Success, title: "初始化完成", message: "⌘+N 可新增代理配置" });
      onSuccess();
    } catch (e: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "初始化失败", message: getErrorMessage(e) });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      navigationTitle="初始化配置管理"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="确认保存" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        title=""
        text="检测到你已有 Claude 配置，将其保存为第一个 Profile，之后可随时新增更多代理。"
      />
      {currentConfig && (
        <>
          <Form.Description
            title="当前代理地址"
            text={currentConfig.env.ANTHROPIC_BASE_URL || "（未设置）"}
          />
          <Form.Description
            title="当前模型"
            text={currentConfig.env.ANTHROPIC_MODEL || "（未设置）"}
          />
          <Form.Separator />
        </>
      )}
      <Form.TextField
        id="name"
        title="配置名称"
        placeholder="default"
        defaultValue="default"
        error={nameError}
        onChange={() => setNameError(undefined)}
        info="只允许小写字母、数字和连字符，如 my-proxy"
      />
    </Form>
  );
}

// ─── 新建 / 编辑 Form ────────────────────────────────────────

interface ProfileFormProps {
  profile?: Profile;
  onSuccess: () => void;
}

function ProfileForm({ profile, onSuccess }: ProfileFormProps) {
  const { pop } = useNavigation();
  const isEditing = !!profile;

  const [nameError, setNameError] = useState<string | undefined>();
  const [urlError, setUrlError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [baseURL, setBaseURL] = useState(profile?.config.env.ANTHROPIC_BASE_URL ?? "");

  useEffect(() => {
    if (!isEditing) {
      LocalStorage.getItem<string>("hasCreatedProfile").then((flag) => {
        if (!flag) setShowSecurity(true);
      });
    }
  }, [isEditing]);

  function handleTemplateChange(id: string) {
    const tpl = PROVIDER_TEMPLATES.find((t) => t.id === id);
    if (tpl && tpl.baseURL) setBaseURL(tpl.baseURL);
  }

  async function handleSubmit(values: {
    name: string;
    apiKey: string;
    model: string;
    activate: boolean;
  }) {
    const nameErr = getNameError(values.name);
    if (nameErr) { setNameError(nameErr); return; }

    const urlErr = getUrlError(baseURL);
    if (urlErr) { setUrlError(urlErr); return; }

    if (!values.apiKey?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "API Key 不能为空" });
      return;
    }
    if (!values.model?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "模型名称不能为空" });
      return;
    }

    // 名称冲突检测（新建模式，或重命名为已存在的名称）
    if (!isEditing && profileExists(values.name)) {
      setNameError("该名称已存在");
      return;
    }
    if (isEditing && profile.name !== values.name && profileExists(values.name)) {
      setNameError("该名称已存在");
      return;
    }

    setIsLoading(true);
    try {
      const config = buildProfileConfig(values.apiKey.trim(), baseURL.trim(), values.model.trim());

      if (isEditing) {
        updateProfile(profile.name, values.name, config, profile.isActive);
        await showToast({ style: Toast.Style.Success, title: "配置已更新" });
      } else {
        writeProfile(values.name, config);
        if (values.activate) {
          switchProfile(values.name);
          await showHUD(`✅ 已切换到 ${values.name}`);
        } else {
          await showToast({ style: Toast.Style.Success, title: `配置 ${values.name} 已创建` });
        }
        await LocalStorage.setItem("hasCreatedProfile", "true");
      }

      onSuccess();
      pop();
    } catch (e: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: isEditing ? "更新失败" : "创建失败",
        message: getErrorMessage(e),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      navigationTitle={isEditing ? `编辑 ${profile.name}` : "新建配置"}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={isEditing ? "保存修改" : "创建配置"} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      {!isEditing && (
        <Form.Dropdown id="template" title="从模板填充" defaultValue="custom" onChange={handleTemplateChange}>
          {PROVIDER_TEMPLATES.map((t) => (
            <Form.Dropdown.Item key={t.id} value={t.id} title={t.name} />
          ))}
        </Form.Dropdown>
      )}
      <Form.TextField
        id="name"
        title="配置名称"
        placeholder="my-proxy"
        defaultValue={profile?.name ?? ""}
        error={nameError}
        onChange={() => setNameError(undefined)}
        info="只允许小写字母、数字和连字符"
      />
      <Form.PasswordField
        id="apiKey"
        title="API Key"
        placeholder="sk-ant-..."
        defaultValue={profile?.config.env.ANTHROPIC_AUTH_TOKEN ?? ""}
      />
      <Form.TextField
        id="baseURL"
        title="代理地址"
        placeholder="https://api.anthropic.com"
        value={baseURL}
        error={urlError}
        onChange={(v) => { setBaseURL(v); setUrlError(undefined); }}
      />
      <Form.TextField
        id="model"
        title="模型名称"
        placeholder="claude-sonnet-4-5"
        defaultValue={profile?.config.env.ANTHROPIC_MODEL ?? ""}
        info="将同时应用到所有 4 个模型字段"
      />
      {!isEditing && (
        <Form.Checkbox id="activate" label="创建后立即激活" defaultValue={true} />
      )}
      {showSecurity && (
        <Form.Description
          title="⚠️ 安全提示"
          text="API Key 以明文存储在 ~/.claude 目录，请勿将配置文件提供给他人。建议创建专用 API Key，并定期更新。"
        />
      )}
    </Form> 
  );
}

// ─── 修改模型 Form ───────────────────────────────────────────

function ModelForm({ profile, onSuccess }: { profile: Profile; onSuccess: () => void }) {
  const { pop } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { model: string }) {
    if (!values.model?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "模型名称不能为空" });
      return;
    }
    setIsLoading(true);
    try {
      updateModel(profile.name, values.model.trim());
      await showToast({ style: Toast.Style.Success, title: `模型已更新为 ${values.model.trim()}` });
      onSuccess();
      pop();
    } catch (e: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "更新失败", message: getErrorMessage(e) });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      navigationTitle={`修改模型 - ${profile.name}`}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="更新模型" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description title="当前模型" text={profile.config.env.ANTHROPIC_MODEL || "（未设置）"} />
      <Form.TextField
        id="model"
        title="新模型名称"
        placeholder="claude-sonnet-4-5"
        info="将同时更新所有 4 个模型字段"
      />
    </Form>
  );
}

// ─── 导入配置 Form ───────────────────────────────────────────

function ImportForm({ onSuccess }: { onSuccess: () => void }) {
  const { pop } = useNavigation();
  const [nameError, setNameError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { jsonText: string; name: string; apiKey?: string }) {
    const nameErr = getNameError(values.name);
    if (nameErr) { setNameError(nameErr); return; }
    if (!values.jsonText?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "请粘贴配置 JSON" });
      return;
    }

    setIsLoading(true);
    try {
      const { config, hasMaskedKey } = parseImportJson(values.jsonText.trim());

      if (hasMaskedKey && !values.apiKey?.trim()) {
        await showToast({
          style: Toast.Style.Failure,
          title: "检测到脱敏 API Key",
          message: "请在下方填写真实 API Key",
        });
        setIsLoading(false);
        return;
      }

      const finalConfig: ProfileConfig =
        hasMaskedKey && values.apiKey
          ? { ...config, env: { ...config.env, ANTHROPIC_AUTH_TOKEN: values.apiKey.trim() } }
          : config;

      writeProfile(values.name, finalConfig);
      await showToast({ style: Toast.Style.Success, title: `配置 ${values.name} 导入成功` });
      onSuccess();
      pop();
    } catch (e: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "导入失败", message: getErrorMessage(e) });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      navigationTitle="导入配置"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="导入" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="jsonText"
        title="粘贴配置 JSON"
        placeholder={'{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-...",\n    "ANTHROPIC_BASE_URL": "https://...",\n    "ANTHROPIC_MODEL": "..."\n  }\n}'}
      />
      <Form.TextField
        id="name"
        title="配置名称"
        placeholder="imported-proxy"
        error={nameError}
        onChange={() => setNameError(undefined)}
        info="保存为 settings-{name}.json"
      />
      <Form.PasswordField
        id="apiKey"
        title="API Key（如 JSON 已脱敏则必填）"
        placeholder="sk-ant-..."
      />
    </Form>
  );
}

// ─── 主命令 ─────────────────────────────────────────────────

export default function Command() {
  const { push } = useNavigation();
  const [view, setView] = useState<"loading" | "wizard" | "list">("loading");
  const [currentConfig, setCurrentConfig] = useState<ProfileConfig | null>(null);
  const [rawProfiles, setRawProfiles] = useState<Profile[]>([]);
  const [connectivityCache, setConnectivityCache] = useState<Record<string, ConnectivityStatus>>({});

  const loadProfiles = useCallback(() => {
    setRawProfiles(scanProfiles());
  }, []);

  // 合并连通性状态
  const profiles: Profile[] = rawProfiles.map((p) => ({
    ...p,
    connectivityStatus: connectivityCache[p.name],
  }));

  useEffect(() => {
    const status = getSettingsStatus();
    if (status === "symlink") {
      loadProfiles();
      setView("list");
    } else if (status === "regular-file") {
      setCurrentConfig(readCurrentConfig());
      setView("wizard");
    } else {
      // settings.json 不存在，直接进入空状态
      setView("list");
    }
  }, []);

  async function handleSwitch(profile: Profile) {
    if (profile.isActive) {
      await showToast({ style: Toast.Style.Animated, title: `${profile.name} 已是当前配置` });
      return;
    }
    try {
      switchProfile(profile.name);
      await showHUD(`✅ 已切换到 ${profile.name}`);
      loadProfiles();
    } catch (e: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "切换失败，请确认 ~/.claude 目录可写",
        message: getErrorMessage(e),
      });
    }
  }

  async function handleDelete(profile: Profile) {
    const confirmed = await confirmAlert({
      title: `删除 ${profile.name}`,
      message: "删除前将自动备份到 ~/.claude/backups/，确认删除？",
      primaryAction: { title: "删除", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      const remaining = rawProfiles.filter((p) => p.name !== profile.name).map((p) => p.name);
      deleteProfile(profile.name, remaining);
      await showToast({ style: Toast.Style.Success, title: `已删除 ${profile.name}` });
      loadProfiles();
    } catch (e: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "删除失败", message: getErrorMessage(e) });
    }
  }

  async function handleTestConnectivity(profile: Profile) {
    await showToast({ style: Toast.Style.Animated, title: `测试 ${profile.name} 连通性...` });
    const result = await testConnectivity(
      profile.config.env.ANTHROPIC_BASE_URL,
      profile.config.env.ANTHROPIC_AUTH_TOKEN
    );
    setConnectivityCache((prev) => ({ ...prev, [profile.name]: result }));
    if (result.ok) {
      await showToast({
        style: Toast.Style.Success,
        title: "连接成功",
        message: `延迟 ${result.latency}ms`,
      });
    } else {
      await showToast({
        style: Toast.Style.Failure,
        title: "连接失败",
        message: result.errorMessage,
      });
    }
  }

  async function handleExport(profile: Profile) {
    try {
      const destPath = exportProfile(profile.name, profile.config);
      await showToast({
        style: Toast.Style.Success,
        title: "导出成功（API Key 已脱敏）",
        message: destPath,
      });
    } catch (e: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "导出失败", message: getErrorMessage(e) });
    }
  }

  // ── 渲染 ──

  if (view === "loading") return <List isLoading />;

  if (view === "wizard") {
    return (
      <InitWizard
        currentConfig={currentConfig}
        onSuccess={() => {
          loadProfiles();
          setView("list");
        }}
      />
    );
  }

  const emptyActions = (
    <ActionPanel>
      <Action
        title="新建配置"
        icon={Icon.Plus}
        onAction={() => push(<ProfileForm onSuccess={loadProfiles} />)}
      />
      <Action
        title="导入配置"
        icon={Icon.Download}
        shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
        onAction={() => push(<ImportForm onSuccess={loadProfiles} />)}
      />
    </ActionPanel>
  );

  return (
    <List isShowingDetail searchBarPlaceholder="搜索配置...">
      {profiles.length === 0 ? (
        <List.EmptyView
          title="还没有配置"
          description="按 ⌘+N 新建你的第一个代理配置"
          icon={Icon.Globe}
          actions={emptyActions}
        />
      ) : (
        profiles.map((profile) => {
          const cs = profile.connectivityStatus;
          const connectivityText = cs
            ? cs.ok
              ? `✅ 可用 · ${cs.latency}ms`
              : `❌ ${cs.errorMessage ?? "不可用"}`
            : "未测试";

          return (
            <List.Item
              key={profile.name}
              title={profile.name}
              subtitle={profile.config.env.ANTHROPIC_BASE_URL}
              accessories={
                profile.isActive
                  ? [{ text: "当前使用", icon: { source: Icon.Checkmark, tintColor: Color.Green } }]
                  : []
              }
              detail={
                <List.Item.Detail
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label
                        title="代理地址"
                        text={profile.config.env.ANTHROPIC_BASE_URL || "—"}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="模型"
                        text={profile.config.env.ANTHROPIC_MODEL || "—"}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="API Key"
                        text={maskApiKey(profile.config.env.ANTHROPIC_AUTH_TOKEN)}
                      />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="连通性" text={connectivityText} />
                      <List.Item.Detail.Metadata.Label
                        title="最后修改"
                        text={profile.lastModified.toLocaleString("zh-CN")}
                      />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    <Action
                      title="切换到此配置"
                      icon={Icon.ArrowRight}
                      onAction={() => handleSwitch(profile)}
                    />
                    <Action
                      title="测试连通性"
                      icon={Icon.Wifi}
                      shortcut={{ modifiers: ["cmd"], key: "t" }}
                      onAction={() => handleTestConnectivity(profile)}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      title="新建配置"
                      icon={Icon.Plus}
                      shortcut={{ modifiers: ["cmd"], key: "n" }}
                      onAction={() => push(<ProfileForm onSuccess={loadProfiles} />)}
                    />
                    <Action
                      title="编辑配置"
                      icon={Icon.Pencil}
                      shortcut={{ modifiers: ["cmd"], key: "e" }}
                      onAction={() => push(<ProfileForm profile={profile} onSuccess={loadProfiles} />)}
                    />
                    <Action
                      title="修改模型"
                      icon={Icon.Gear}
                      shortcut={{ modifiers: ["cmd"], key: "m" }}
                      onAction={() => push(<ModelForm profile={profile} onSuccess={loadProfiles} />)}
                    />
                    <Action
                      title="删除配置"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["cmd"], key: "d" }}
                      onAction={() => handleDelete(profile)}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      title="导出配置（API Key 脱敏）"
                      icon={Icon.Upload}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                      onAction={() => handleExport(profile)}
                    />
                    <Action
                      title="导入配置"
                      icon={Icon.Download}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
                      onAction={() => push(<ImportForm onSuccess={loadProfiles} />)}
                    />
                    <Action
                      title="刷新列表"
                      icon={Icon.ArrowClockwise}
                      shortcut={{ modifiers: ["cmd"], key: "r" }}
                      onAction={loadProfiles}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
