import { useState } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  LanguagesIcon,
  SunMoonIcon,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { FlowerAvatar } from "@/components/flower-avatar";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from "@/components/modal";
import { Screen } from "@/components/screen";
import { languageName } from "@/locale/language-name";
import { type Theme, useTheme } from "@/components/theme-provider";
import { m } from "@/paraglide/messages";
import {
  type Locale,
  getLocale,
  locales,
  setLocale,
} from "@/paraglide/runtime";
import { useSavedUsername } from "@/wallet/use-saved-username";

export const Route = createFileRoute("/_wallet/_app/settings")({
  component: SettingsScreen,
});

type Choice<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly lang?: string;
  readonly hint?: string;
};

type OpenChoice = "language" | "appearance" | "none";

const themes: ReadonlyArray<Theme> = ["system", "light", "dark"];

const themeName = (theme: Theme) =>
  Match.value(theme).pipe(
    Match.when("system", () => m.theme_system()),
    Match.when("light", () => m.theme_light()),
    Match.when("dark", () => m.theme_dark()),
    Match.exhaustive,
  );

const languageChoices = () =>
  locales.map((locale): Choice<Locale> => ({
    value: locale,
    label: languageName(locale),
    lang: locale,
  }));

const themeChoices = () =>
  themes.map((theme): Choice<Theme> => ({
    value: theme,
    label: themeName(theme),
    hint: theme === "system" ? m.theme_system_explanation() : undefined,
  }));

function SettingsScreen() {
  const locale = getLocale();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState<OpenChoice>("none");

  return (
    <Screen>
      <main className="flex flex-1 flex-col gap-8 px-5 pt-6 pb-30 md:pt-2 md:pb-16">
        <h1 className="font-display text-h1">{m.settings_title()}</h1>
        <Identity />
        <section aria-labelledby="preferences" className="flex flex-col gap-2">
          <h2
            id="preferences"
            className="px-1 text-label text-muted-foreground"
          >
            {m.settings_preferences()}
          </h2>
          <div className="flex flex-col gap-2">
            <PreferenceRow
              icon={<LanguagesIcon />}
              title={m.settings_language()}
              value={languageName(locale)}
              onOpen={() => setOpen("language")}
            />
            <PreferenceRow
              icon={<SunMoonIcon />}
              title={m.settings_appearance()}
              value={themeName(theme)}
              onOpen={() => setOpen("appearance")}
            />
          </div>
        </section>
      </main>
      <ChoiceModal
        open={open === "language"}
        onClose={() => setOpen("none")}
        title={m.settings_language()}
        description={m.settings_language_explanation()}
        choices={languageChoices()}
        selected={locale}
        onChoose={(chosen) => {
          if (chosen !== locale) setLocale(chosen);
        }}
      />
      <ChoiceModal
        open={open === "appearance"}
        onClose={() => setOpen("none")}
        title={m.settings_appearance()}
        choices={themeChoices()}
        selected={theme}
        onChoose={(chosen) => {
          setTheme(chosen);
          setOpen("none");
        }}
      />
    </Screen>
  );
}

function Identity() {
  const { read, username } = useSavedUsername();

  if (!read)
    return (
      <div className="flex flex-col items-center gap-3">
        <Skeleton variant="avatar" className="size-18" />
        <Skeleton
          aria-label={m.settings_loading_username()}
          className="h-5 w-28"
        />
      </div>
    );

  return Option.match(username, {
    onNone: () => null,
    onSome: (name) => (
      <div className="flex flex-col items-center gap-3">
        <FlowerAvatar username={name} size="xl" />
        <p className="text-label-lg" data-testid="settings-username">
          @{name}
        </p>
      </div>
    ),
  });
}

function PreferenceRow({
  icon,
  title,
  value,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  onOpen: () => void;
}) {
  return (
    <Item
      variant="outline"
      className="text-left"
      render={<button type="button" aria-haspopup="dialog" onClick={onOpen} />}
    >
      <ItemMedia variant="muted">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <span className="text-body text-muted-foreground">{value}</span>
        <ChevronRightIcon absoluteStrokeWidth />
      </ItemActions>
    </Item>
  );
}

function ChoiceModal<Value extends string>({
  open,
  onClose,
  title,
  description,
  choices,
  selected,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  choices: ReadonlyArray<Choice<Value>>;
  selected: Value;
  onChoose: (value: Value) => void;
}) {
  return (
    <Modal open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          {description === undefined ? null : (
            <ModalDescription>{description}</ModalDescription>
          )}
        </ModalHeader>
        <div className="flex flex-col gap-1 p-4">
          {choices.map((choice) => (
            <Item
              key={choice.value}
              size="sm"
              className="text-left"
              render={
                <button
                  type="button"
                  lang={choice.lang}
                  aria-pressed={choice.value === selected}
                  onClick={() => onChoose(choice.value)}
                />
              }
            >
              <ItemContent>
                <ItemTitle>{choice.label}</ItemTitle>
                {choice.hint === undefined ? null : (
                  <ItemDescription>{choice.hint}</ItemDescription>
                )}
              </ItemContent>
              {choice.value === selected ? (
                <ItemActions>
                  <CheckIcon />
                </ItemActions>
              ) : null}
            </Item>
          ))}
        </div>
      </ModalContent>
    </Modal>
  );
}
