"use client";

import React, { useState, useEffect } from "react";
import { Button, Card, Input, Select, Tabs } from "@/components/ui/Input";
import { useI18n, type TranslationKey } from "@/lib/i18n";

interface MobileComponentsTabProps {
  app: {
    id: string;
    appName: string;
    designKit: string;
  };
  loading: boolean;
}

interface ComponentInfo {
  id: string;
  name: string;
  platform: "ios" | "android" | "shared";
  category: string;
  description: string;
  preview: string;
  code: string;
  usage: string;
  props: string[];
}

const IOS_27_COMPONENTS: ComponentInfo[] = [
  {
    id: "ios-navigation-bar",
    name: "Navigation Bar (Liquid Glass)",
    platform: "ios",
    category: "Navigation",
    description: "Liquid Glass navigation bar with blur and translucency",
    preview: "https://via.placeholder.com/300x60/0A84FF/FFFFFF?text=Navigation+Bar",
    code: `import { LiquidGlassNavigationBar } from "@infinity-ai/liquid-glass";

export function MyScreen() {
  return (
    <LiquidGlassNavigationBar
      title="Home"
      translucent
      glassEffect="liquid"
      leftItems={[<Icon name="chevron.left" />]}
      rightItems={[<Icon name="ellipsis" />]}
    />
  );
}`,
    usage: "Use for top navigation in iOS 27 apps with Liquid Glass aesthetic.",
    props: ["title: string", "translucent?: boolean", "glassEffect?: 'liquid' | 'regular'", "leftItems?: ReactNode[]", "rightItems?: ReactNode[]"],
  },
  {
    id: "ios-tab-bar",
    name: "Tab Bar (Liquid Glass)",
    platform: "ios",
    category: "Navigation",
    description: "Floating Liquid Glass tab bar with blur",
    preview: "https://via.placeholder.com/300x80/0A84FF/FFFFFF?text=Tab+Bar",
    code: `import { LiquidGlassTabBar } from "@infinity-ai/liquid-glass";

export function MyTabBar() {
  return (
    <LiquidGlassTabBar
      items={[
        { icon: "house.fill", label: "Home", active: true },
        { icon: "magnifyingglass", label: "Search" },
        { icon: "person.fill", label: "Profile" },
      ]}
      glassEffect="liquid"
    />
  );
}`,
    usage: "Bottom navigation for iOS 27 apps.",
    props: ["items: TabItem[]", "glassEffect?: 'liquid' | 'regular'", "onTabPress?: (index: number) => void"],
  },
  {
    id: "ios-button",
    name: "Button (Liquid Glass)",
    platform: "ios",
    category: "Controls",
    description: "Glassy button with hover and press states",
    preview: "https://via.placeholder.com/160x44/0A84FF/FFFFFF?text=Button",
    code: `import { LiquidGlassButton } from "@infinity-ai/liquid-glass";

export function MyButton() {
  return (
    <LiquidGlassButton
      variant="primary"
      glassEffect="liquid"
      onPress={() => console.log("Pressed")}
    >
      Continue
    </LiquidGlassButton>
  );
}`,
    usage: "Primary and secondary actions in iOS 27 apps.",
    props: ["variant?: 'primary' | 'secondary' | 'ghost'", "glassEffect?: 'liquid' | 'regular'", "onPress?: () => void"],
  },
  {
    id: "ios-card",
    name: "Card (Liquid Glass)",
    platform: "ios",
    category: "Containers",
    description: "Translucent glass card with rounded corners",
    preview: "https://via.placeholder.com/200x120/0A84FF/FFFFFF?text=Card",
    code: `import { LiquidGlassCard } from "@infinity-ai/liquid-glass";

export function MyCard() {
  return (
    <LiquidGlassCard glassEffect="liquid" padding={16}>
      <Text>Title</Text>
      <Text>Content goes here</Text>
    </LiquidGlassCard>
  );
}`,
    usage: "Content containers in iOS 27 apps.",
    props: ["glassEffect?: 'liquid' | 'regular'", "padding?: number", "elevation?: 'low' | 'medium' | 'high'"],
  },
  {
    id: "ios-sheet",
    name: "Sheet (Liquid Glass)",
    platform: "ios",
    category: "Overlays",
    description: "Bottom sheet with glass backdrop",
    preview: "https://via.placeholder.com/300x200/0A84FF/FFFFFF?text=Sheet",
    code: `import { LiquidGlassSheet } from "@infinity-ai/liquid-glass";

export function MySheet({ open, onClose }) {
  return (
    <LiquidGlassSheet
      isOpen={open}
      onClose={onClose}
      glassEffect="liquid"
      detent="medium"
    >
      <Text>Sheet Content</Text>
    </LiquidGlassSheet>
  );
}`,
    usage: "Modal presentations in iOS 27 apps.",
    props: ["isOpen: boolean", "onClose: () => void", "detent?: 'small' | 'medium' | 'large'", "glassEffect?: 'liquid' | 'regular'"],
  },
  {
    id: "ios-search",
    name: "Search Field (Liquid Glass)",
    platform: "ios",
    category: "Inputs",
    description: "Glass search field with live filtering",
    preview: "https://via.placeholder.com/300x44/0A84FF/FFFFFF?text=Search",
    code: `import { LiquidGlassSearchField } from "@infinity-ai/liquid-glass";

export function MySearch() {
  return (
    <LiquidGlassSearchField
      placeholder="Search"
      glassEffect="liquid"
      onChange={(text) => console.log(text)}
    />
  );
}`,
    usage: "Search inputs in iOS 27 apps.",
    props: ["placeholder?: string", "glassEffect?: 'liquid' | 'regular'", "onChange?: (text: string) => void"],
  },
  {
    id: "ios-toggle",
    name: "Toggle (Liquid Glass)",
    platform: "ios",
    category: "Controls",
    description: "Glass toggle switch",
    preview: "https://via.placeholder.com/60x32/0A84FF/FFFFFF?text=🔀",
    code: `import { LiquidGlassToggle } from "@infinity-ai/liquid-glass";

export function MyToggle() {
  return (
    <LiquidGlassToggle
      value={true}
      glassEffect="liquid"
      onValueChange={(v) => console.log(v)}
    />
  );
}`,
    usage: "Boolean settings in iOS 27 apps.",
    props: ["value: boolean", "glassEffect?: 'liquid' | 'regular'", "onValueChange?: (value: boolean) => void"],
  },
  {
    id: "ios-slider",
    name: "Slider (Liquid Glass)",
    platform: "ios",
    category: "Controls",
    description: "Glass slider with haptic feedback",
    preview: "https://via.placeholder.com/200x32/0A84FF/FFFFFF?text=Slider",
    code: `import { LiquidGlassSlider } from "@infinity-ai/liquid-glass";

export function MySlider() {
  return (
    <LiquidGlassSlider
      value={0.5}
      glassEffect="liquid"
      onValueChange={(v) => console.log(v)}
    />
  );
}`,
    usage: "Range inputs in iOS 27 apps.",
    props: ["value: number", "min?: number", "max?: number", "glassEffect?: 'liquid' | 'regular'", "onValueChange?: (value: number) => void"],
  },
  {
    id: "ios-list",
    name: "List (Liquid Glass)",
    platform: "ios",
    category: "Containers",
    description: "Glass list with grouped sections",
    preview: "https://via.placeholder.com/300x200/0A84FF/FFFFFF?text=List",
    code: `import { LiquidGlassList, LiquidGlassListSection } from "@infinity-ai/liquid-glass";

export function MyList() {
  return (
    <LiquidGlassList glassEffect="liquid">
      <LiquidGlassListSection header="Settings">
        <LiquidGlassListRow title="Account" />
        <LiquidGlassListRow title="Privacy" />
      </LiquidGlassListSection>
    </LiquidGlassList>
  );
}`,
    usage: "Structured content in iOS 27 apps.",
    props: ["glassEffect?: 'liquid' | 'regular'", "sections?: ListSection[]"],
  },
  {
    id: "ios-dialog",
    name: "Dialog (Liquid Glass)",
    platform: "ios",
    category: "Overlays",
    description: "Glass alert dialog with actions",
    preview: "https://via.placeholder.com/300x150/0A84FF/FFFFFF?text=Dialog",
    code: `import { LiquidGlassDialog } from "@infinity-ai/liquid-glass";

export function MyDialog({ open, onClose }) {
  return (
    <LiquidGlassDialog
      isOpen={open}
      title="Delete Item?"
      message="This action cannot be undone."
      glassEffect="liquid"
      actions={[
        { text: "Cancel", style: "cancel", onPress: onClose },
        { text: "Delete", style: "destructive", onPress: () => {} },
      ]}
    />
  );
}`,
    usage: "Confirmations in iOS 27 apps.",
    props: ["isOpen: boolean", "title: string", "message?: string", "glassEffect?: 'liquid' | 'regular'", "actions: DialogAction[]"],
  },
];

const MATERIAL_3_COMPONENTS: ComponentInfo[] = [
  {
    id: "m3-button",
    name: "Button (Material 3)",
    platform: "android",
    category: "Actions",
    description: "Material 3 filled, tonal, and outlined buttons",
    preview: "https://via.placeholder.com/160x40/6750A4/FFFFFF?text=Button",
    code: `import { M3Button } from "@infinity-ai/material-3";

export function MyButton() {
  return (
    <M3Button
      variant="filled"
      onClick={() => console.log("Pressed")}
    >
      Continue
    </M3Button>
  );
}`,
    usage: "Primary actions in Material 3 apps.",
    props: ["variant?: 'filled' | 'tonal' | 'outlined' | 'text'", "onClick?: () => void", "disabled?: boolean"],
  },
  {
    id: "m3-card",
    name: "Card (Material 3)",
    platform: "android",
    category: "Containers",
    description: "Elevated card with rounded corners",
    preview: "https://via.placeholder.com/200x120/6750A4/FFFFFF?text=Card",
    code: `import { M3Card } from "@infinity-ai/material-3";

export function MyCard() {
  return (
    <M3Card elevation={1} onClick={() => {}}>
      <M3CardContent>
        <M3Text variant="title-medium">Title</M3Text>
        <M3Text variant="body-medium">Content</M3Text>
      </M3CardContent>
    </M3Card>
  );
}`,
    usage: "Content containers in Material 3 apps.",
    props: ["elevation?: 0 | 1 | 2 | 3", "onClick?: () => void"],
  },
  {
    id: "m3-top-app-bar",
    name: "Top App Bar (Material 3)",
    platform: "android",
    category: "Navigation",
    description: "Material 3 top app bar with scroll behavior",
    preview: "https://via.placeholder.com/300x56/6750A4/FFFFFF?text=Top+App+Bar",
    code: `import { M3TopAppBar } from "@infinity-ai/material-3";

export function MyTopAppBar() {
  return (
    <M3TopAppBar
      title="Home"
      navigationIcon={<Icon name="menu" />}
      actions={[<Icon name="search" />, <Icon name="more_vert" />]}
    />
  );
}`,
    usage: "Top navigation in Material 3 apps.",
    props: ["title: string", "navigationIcon?: ReactNode", "actions?: ReactNode[]"],
  },
  {
    id: "m3-navigation-bar",
    name: "Navigation Bar (Material 3)",
    platform: "android",
    category: "Navigation",
    description: "Material 3 bottom navigation bar",
    preview: "https://via.placeholder.com/300x80/6750A4/FFFFFF?text=Nav+Bar",
    code: `import { M3NavigationBar } from "@infinity-ai/material-3";

export function MyNavBar() {
  return (
    <M3NavigationBar
      items={[
        { icon: "home", label: "Home", active: true },
        { icon: "search", label: "Search" },
        { icon: "person", label: "Profile" },
      ]}
      onItemPress={(i) => console.log(i)}
    />
  );
}`,
    usage: "Bottom navigation in Material 3 apps.",
    props: ["items: NavItem[]", "onItemPress?: (index: number) => void"],
  },
  {
    id: "m3-text-field",
    name: "Text Field (Material 3)",
    platform: "android",
    category: "Inputs",
    description: "Material 3 outlined/filled text field",
    preview: "https://via.placeholder.com/300x56/6750A4/FFFFFF?text=Text+Field",
    code: `import { M3TextField } from "@infinity-ai/material-3";

export function MyTextField() {
  return (
    <M3TextField
      label="Email"
      variant="outlined"
      onChange={(text) => console.log(text)}
    />
  );
}`,
    usage: "Text inputs in Material 3 apps.",
    props: ["label?: string", "variant?: 'filled' | 'outlined'", "onChange?: (text: string) => void"],
  },
  {
    id: "m3-fab",
    name: "FAB (Material 3)",
    platform: "android",
    category: "Actions",
    description: "Floating action button",
    preview: "https://via.placeholder.com/56x56/6750A4/FFFFFF?text=+",
    code: `import { M3FAB } from "@infinity-ai/material-3";

export function MyFAB() {
  return (
    <M3FAB
      icon="add"
      onClick={() => console.log("FAB pressed")}
    />
  );
}`,
    usage: "Primary action in Material 3 apps.",
    props: ["icon: string", "onClick?: () => void", "variant?: 'surface' | 'primary' | 'secondary'"],
  },
  {
    id: "m3-switch",
    name: "Switch (Material 3)",
    platform: "android",
    category: "Controls",
    description: "Material 3 switch",
    preview: "https://via.placeholder.com/52x32/6750A4/FFFFFF?text=🔀",
    code: `import { M3Switch } from "@infinity-ai/material-3";

export function MySwitch() {
  return (
    <M3Switch
      checked={true}
      onChange={(c) => console.log(c)}
    />
  );
}`,
    usage: "Boolean settings in Material 3 apps.",
    props: ["checked: boolean", "onChange?: (checked: boolean) => void"],
  },
  {
    id: "m3-slider",
    name: "Slider (Material 3)",
    platform: "android",
    category: "Controls",
    description: "Material 3 slider with labels",
    preview: "https://via.placeholder.com/200x48/6750A4/FFFFFF?text=Slider",
    code: `import { M3Slider } from "@infinity-ai/material-3";

export function MySlider() {
  return (
    <M3Slider
      value={50}
      min={0}
      max={100}
      onChange={(v) => console.log(v)}
    />
  );
}`,
    usage: "Range inputs in Material 3 apps.",
    props: ["value: number", "min?: number", "max?: number", "onChange?: (value: number) => void"],
  },
  {
    id: "m3-dialog",
    name: "Dialog (Material 3)",
    platform: "android",
    category: "Overlays",
    description: "Material 3 alert dialog",
    preview: "https://via.placeholder.com/300x150/6750A4/FFFFFF?text=Dialog",
    code: `import { M3Dialog } from "@infinity-ai/material-3";

export function MyDialog({ open, onClose }) {
  return (
    <M3Dialog
      open={open}
      title="Delete Item?"
      content="This action cannot be undone."
      actions={[
        { text: "Cancel", onPress: onClose },
        { text: "Delete", onPress: () => {} },
      ]}
    />
  );
}`,
    usage: "Confirmations in Material 3 apps.",
    props: ["open: boolean", "title: string", "content?: string", "actions: DialogAction[]"],
  },
  {
    id: "m3-chip",
    name: "Chip (Material 3)",
    platform: "android",
    category: "Inputs",
    description: "Material 3 filter/assist/input chips",
    preview: "https://via.placeholder.com/100x32/6750A4/FFFFFF?text=Chip",
    code: `import { M3Chip } from "@infinity-ai/material-3";

export function MyChip() {
  return (
    <M3Chip
      label="Filter"
      variant="filter"
      selected={true}
      onSelect={(s) => console.log(s)}
    />
  );
}`,
    usage: "Tags and filters in Material 3 apps.",
    props: ["label: string", "variant?: 'assist' | 'filter' | 'input' | 'suggestion'", "selected?: boolean", "onSelect?: (selected: boolean) => void"],
  },
  {
    id: "m3-list",
    name: "List (Material 3)",
    platform: "android",
    category: "Containers",
    description: "Material 3 list with items",
    preview: "https://via.placeholder.com/300x200/6750A4/FFFFFF?text=List",
    code: `import { M3List, M3ListItem } from "@infinity-ai/material-3";

export function MyList() {
  return (
    <M3List>
      <M3ListItem
        headline="Account"
        leading={<Icon name="person" />}
        trailing={<Icon name="chevron_right" />}
        onClick={() => {}}
      />
    </M3List>
  );
}`,
    usage: "Structured content in Material 3 apps.",
    props: ["headline: string", "supportingText?: string", "leading?: ReactNode", "trailing?: ReactNode", "onClick?: () => void"],
  },
  {
    id: "m3-bottom-sheet",
    name: "Bottom Sheet (Material 3)",
    platform: "android",
    category: "Overlays",
    description: "Material 3 modal bottom sheet",
    preview: "https://via.placeholder.com/300x200/6750A4/FFFFFF?text=Sheet",
    code: `import { M3BottomSheet } from "@infinity-ai/material-3";

export function MySheet({ open, onClose }) {
  return (
    <M3BottomSheet
      isOpen={open}
      onClose={onClose}
      title="Options"
    >
      <M3List>...</M3List>
    </M3BottomSheet>
  );
}`,
    usage: "Modal presentations in Material 3 apps.",
    props: ["isOpen: boolean", "onClose: () => void", "title?: string"],
  },
];

const SHARED_COMPONENTS: ComponentInfo[] = [
  {
    id: "shared-icon",
    name: "Icon (Cross-Platform)",
    platform: "shared",
    category: "Primitives",
    description: "SF Symbol / Material icon mapping",
    preview: "https://via.placeholder.com/48x48/888888/FFFFFF?text=🔷",
    code: `import { Icon } from "@infinity-ai/shared";

export function MyIcon() {
  return <Icon name="heart" size={24} color="#FF3B30" />;
}`,
    usage: "Use for consistent icons across both platforms.",
    props: ["name: string", "size?: number", "color?: string"],
  },
  {
    id: "shared-text",
    name: "Text (Cross-Platform)",
    platform: "shared",
    category: "Primitives",
    description: "Typography with platform-aware styling",
    preview: "https://via.placeholder.com/200x40/888888/FFFFFF?text=Text",
    code: `import { Text } from "@infinity-ai/shared";

export function MyText() {
  return <Text variant="headline-medium">Hello World</Text>;
}`,
    usage: "Use for all text in your app.",
    props: ["variant?: 'display' | 'headline' | 'title' | 'body' | 'label'", "children: ReactNode"],
  },
  {
    id: "shared-stack",
    name: "Stack (Cross-Platform)",
    platform: "shared",
    category: "Layout",
    description: "VStack / HStack / ZStack layout primitives",
    preview: "https://via.placeholder.com/200x100/888888/FFFFFF?text=Stack",
    code: `import { VStack, HStack } from "@infinity-ai/shared";

export function MyStack() {
  return (
    <VStack spacing={8} align="center">
      <HStack spacing={4}>
        <Icon name="star" />
        <Text>Rating</Text>
      </HStack>
    </VStack>
  );
}`,
    usage: "Use for layout composition.",
    props: ["spacing?: number", "align?: 'start' | 'center' | 'end'", "children: ReactNode"],
  },
  {
    id: "shared-scroll-view",
    name: "ScrollView (Cross-Platform)",
    platform: "shared",
    category: "Layout",
    description: "Scrollable container with platform scroll physics",
    preview: "https://via.placeholder.com/200x200/888888/FFFFFF?text=Scroll",
    code: `import { ScrollView } from "@infinity-ai/shared";

export function MyScroll() {
  return (
    <ScrollView horizontal={false} showsScrollIndicator>
      <Content />
    </ScrollView>
  );
}`,
    usage: "Use for scrollable content.",
    props: ["horizontal?: boolean", "showsScrollIndicator?: boolean", "children: ReactNode"],
  },
  {
    id: "shared-image",
    name: "Image (Cross-Platform)",
    platform: "shared",
    category: "Primitives",
    description: "Image with placeholder and caching",
    preview: "https://via.placeholder.com/200x200/888888/FFFFFF?text=Image",
    code: `import { Image } from "@infinity-ai/shared";

export function MyImage() {
  return (
    <Image
      source="https://example.com/photo.jpg"
      placeholder="blur"
      width={200}
      height={200}
    />
  );
}`,
    usage: "Use for images with loading states.",
    props: ["source: string", "placeholder?: 'blur' | 'solid'", "width?: number", "height?: number"],
  },
  {
    id: "shared-loading",
    name: "Loading (Cross-Platform)",
    platform: "shared",
    category: "Feedback",
    description: "Platform-aware activity indicator",
    preview: "https://via.placeholder.com/48x48/888888/FFFFFF?text=⏳",
    code: `import { Loading } from "@infinity-ai/shared";

export function MyLoading() {
  return <Loading size="large" />;
}`,
    usage: "Use for loading states.",
    props: ["size?: 'small' | 'large'", "color?: string"],
  },
];

export const MobileComponentsTab: React.FC<MobileComponentsTabProps> = ({ app, loading }) => {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | "ios" | "android" | "shared">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedComponent, setSelectedComponent] = useState<ComponentInfo | null>(null);
  const [showCode, setShowCode] = useState(true);

  const components = [
    ...(filter === "all" || filter === "ios" ? IOS_27_COMPONENTS : []),
    ...(filter === "all" || filter === "android" ? MATERIAL_3_COMPONENTS : []),
    ...(filter === "all" || filter === "shared" ? SHARED_COMPONENTS : []),
  ];

  const categories = ["all", ...Array.from(new Set(components.map((c) => c.category)))];

  const filteredComponents = components.filter((c) => {
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{t("mobile.components.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {app.designKit === "ios-27"
                ? "Official iOS 27 Liquid Glass components"
                : app.designKit === "material-3"
                ? "Official Material You 3 components"
                : "Official cross-platform components"}
            </p>
          </div>
          {selectedComponent && (
            <Button variant="outline" size="sm" onClick={() => setSelectedComponent(null)}>
              ← {t("common.back")}
            </Button>
          )}
        </div>

        {!selectedComponent && (
          <div className="flex items-center gap-4 flex-wrap">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              options={[
                { value: "all", label: "All Platforms" },
                { value: "ios", label: "iOS 27" },
                { value: "android", label: "Material 3" },
                { value: "shared", label: "Shared" },
              ]}
              className="w-[150px]"
            />
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={categories.map((c) => ({ value: c, label: c === "all" ? "All Categories" : c }))}
              className="w-[160px]"
            />
            <Input
              placeholder="Search components..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 min-w-[200px]"
            />
          </div>
        )}
      </Card>

      {/* Component Detail / List */}
      {selectedComponent ? (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                selectedComponent.platform === "ios" ? "bg-primary/10 text-primary" :
                selectedComponent.platform === "android" ? "bg-green-500/10 text-green-500" :
                "bg-muted text-muted-foreground"
              }`}>
                {selectedComponent.platform.toUpperCase()}
              </span>
              <span className="text-sm text-muted-foreground">{selectedComponent.category}</span>
            </div>
          </div>

          <h2 className="text-xl font-bold mb-2">{selectedComponent.name}</h2>
          <p className="text-muted-foreground mb-4">{selectedComponent.description}</p>

          {/* Preview */}
          <div className="mb-6">
            <h3 className="font-medium mb-2">{t("mobile.components.preview")}</h3>
            <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-center min-h-[120px]">
              {selectedComponent.platform === "ios" ? (
                <div className="text-center">
                  <div className="text-primary font-mono text-xs mb-2">iOS 27 Liquid Glass</div>
                  <div className="px-4 py-2 bg-primary/10 border border-primary/20 rounded-lg backdrop-blur">
                    {selectedComponent.name}
                  </div>
                </div>
              ) : selectedComponent.platform === "android" ? (
                <div className="text-center">
                  <div className="text-green-500 font-mono text-xs mb-2">Material You 3</div>
                  <div className="px-4 py-2 bg-green-500/10 border border-green-500/20 rounded">
                    {selectedComponent.name}
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-muted-foreground font-mono text-xs mb-2">Shared Cross-Platform</div>
                  <div className="px-4 py-2 bg-muted border border-border rounded">
                    {selectedComponent.name}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Code */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">{t("mobile.components.code")}</h3>
              <Button variant="ghost" size="sm" onClick={() => handleCopyCode(selectedComponent.code)}>
                Copy
              </Button>
            </div>
            <pre className="bg-black/20 rounded-lg p-4 overflow-auto font-mono text-sm">
              <code>{selectedComponent.code}</code>
            </pre>
          </div>

          {/* Props */}
          <div className="mt-4">
            <h3 className="font-medium mb-2">{t("mobile.components.props")}</h3>
            <div className="space-y-1">
              {selectedComponent.props.map((prop, i) => (
                <div key={i} className="text-sm font-mono bg-muted/30 px-3 py-1.5 rounded">
                  {prop}
                </div>
              ))}
            </div>
          </div>

          {/* Usage */}
          <div className="mt-4">
            <h3 className="font-medium mb-2">{t("mobile.components.usage")}</h3>
            <p className="text-sm text-muted-foreground">{selectedComponent.usage}</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredComponents.map((component) => (
            <Card
              key={component.id}
              className="p-4 hover:border-primary/30 cursor-pointer transition"
              onClick={() => setSelectedComponent(component)}
            >
              <div className="flex items-start justify-between mb-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  component.platform === "ios" ? "bg-primary/10 text-primary" :
                  component.platform === "android" ? "bg-green-500/10 text-green-500" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {component.platform.toUpperCase()}
                </span>
              </div>
              <h4 className="font-semibold text-sm mb-1">{component.name}</h4>
              <p className="text-xs text-muted-foreground line-clamp-2">{component.description}</p>
              <div className="mt-2 text-xs text-muted-foreground">{component.category}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};