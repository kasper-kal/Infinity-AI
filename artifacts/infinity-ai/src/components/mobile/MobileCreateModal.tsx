"use client";

import React, { useState } from "react";
import { Button, Input, Textarea, Select, SelectOption, Checkbox, Label } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface MobileCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (appData: {
    name: string;
    appName: string;
    bundleIdentifier: string;
    packageName: string;
    platform: "ios" | "android" | "both";
    designKit: string;
    customFigmaUrl?: string;
    template: string;
    capabilities: Record<string, boolean>;
  }) => void;
  loading?: boolean;
}

export const MobileCreateModal: React.FC<MobileCreateModalProps> = ({
  open,
  onClose,
  onCreate,
  loading,
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState({
    name: "",
    appName: "",
    bundleIdentifier: "",
    packageName: "",
    platform: "both" as "ios" | "android" | "both",
    designKit: "ios-27",
    customFigmaUrl: "",
    template: "blank",
    capabilities: {
      camera: false,
      location: false,
      push: false,
      biometrics: false,
      haptics: false,
      contacts: false,
      mediaLibrary: false,
      motion: false,
    },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Required";
    if (!formData.appName.trim()) newErrors.appName = "Required";
    if (!formData.bundleIdentifier.trim()) newErrors.bundleIdentifier = "Required (e.g. com.example.app)";
    if (!formData.packageName.trim()) newErrors.packageName = "Required (e.g. com.example.app)";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onCreate(formData);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((prev) => ({
        ...prev,
        capabilities: { ...prev.capabilities, [name]: (e.target as HTMLInputElement).checked },
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const platforms = [
    { value: "both", label: t("mobile.platform.both") },
    { value: "ios", label: t("mobile.platform.ios") },
    { value: "android", label: t("mobile.platform.android") },
  ];

  const designKits = [
    { value: "ios-27", label: t("mobile.designKit.ios27") },
    { value: "material-3", label: t("mobile.designKit.material3") },
    { value: "custom", label: t("mobile.designKit.custom") },
  ];

  const templates = [
    { value: "blank", label: t("mobile.template.blank") },
    { value: "tabs", label: t("mobile.template.tabs") },
    { value: "stack", label: t("mobile.template.stack") },
    { value: "drawer", label: t("mobile.template.drawer") },
    { value: "auth", label: t("mobile.template.auth") },
    { value: "social", label: t("mobile.template.social") },
    { value: "ecommerce", label: t("mobile.template.ecommerce") },
    { value: "content", label: t("mobile.template.content") },
    { value: "dashboard", label: t("mobile.template.dashboard") },
  ];

  const capabilities = [
    { key: "camera", label: t("mobile.capability.camera") },
    { key: "location", label: t("mobile.capability.location") },
    { key: "push", label: t("mobile.capability.push") },
    { key: "biometrics", label: t("mobile.capability.biometrics") },
    { key: "haptics", label: t("mobile.capability.haptics") },
    { key: "contacts", label: t("mobile.capability.contacts") },
    { key: "mediaLibrary", label: t("mobile.capability.mediaLibrary") },
    { key: "motion", label: t("mobile.capability.motion") },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onClose}
      title={t("mobile.createApp")}
      description={t("mobile.createFirst")}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
        <div className="space-y-2">
          <Label htmlFor="name">{t("mobile.appName")}</Label>
          <Input
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder={t("mobile.appNamePlaceholder")}
            error={errors.name}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bundleIdentifier">{t("mobile.bundleIdentifier")}</Label>
          <Input
            id="bundleIdentifier"
            name="bundleIdentifier"
            value={formData.bundleIdentifier}
            onChange={handleChange}
            placeholder={t("mobile.bundleIdentifierPlaceholder")}
            error={errors.bundleIdentifier}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="packageName">{t("mobile.packageName")}</Label>
          <Input
            id="packageName"
            name="packageName"
            value={formData.packageName}
            onChange={handleChange}
            placeholder={t("mobile.packageNamePlaceholder")}
            error={errors.packageName}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("mobile.platform")}</Label>
          <Select
            name="platform"
            value={formData.platform}
            onChange={handleChange}
            options={platforms}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label>{t("mobile.designKit")}</Label>
          <Select
            name="designKit"
            value={formData.designKit}
            onChange={handleChange}
            options={designKits}
            className="w-full"
          />
        </div>

        {formData.designKit === "custom" && (
          <div className="space-y-2">
            <Label htmlFor="customFigmaUrl">{t("mobile.customFigmaUrl")}</Label>
            <Input
              id="customFigmaUrl"
              name="customFigmaUrl"
              value={formData.customFigmaUrl}
              onChange={handleChange}
              placeholder={t("mobile.customFigmaUrlPlaceholder")}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("mobile.template")}</Label>
          <Select
            name="template"
            value={formData.template}
            onChange={handleChange}
            options={templates}
            className="w-full"
          />
        </div>

        <div className="space-y-2 pt-2 border-t border-border">
          <Label className="block mb-2 font-medium">{t("mobile.capabilities")}</Label>
          <div className="grid grid-cols-2 gap-3">
            {capabilities.map((cap) => (
              <label key={cap.key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  name={cap.key}
                  checked={formData.capabilities[cap.key]}
                  onChange={handleChange}
                />
                <span className="text-sm">{cap.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? t("mobile.creating") : t("mobile.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};