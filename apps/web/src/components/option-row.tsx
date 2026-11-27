import { ChevronRightIcon } from "lucide-react";
import type { useRender } from "@base-ui/react/use-render";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";

export function OptionRow({
  title,
  description,
  media,
  mediaVariant = "icon",
  render = <button type="button" />,
  disabled = false,
}: {
  title: string;
  description: string;
  media: React.ReactNode;
  mediaVariant?: "icon" | "muted";
  render?: useRender.RenderProp;
  disabled?: boolean;
}) {
  return (
    <Item
      variant="outline"
      className="text-left"
      render={disabled ? <button type="button" disabled /> : render}
    >
      <ItemMedia variant={mediaVariant}>{media}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      {disabled ? null : (
        <ItemActions>
          <ChevronRightIcon absoluteStrokeWidth />
        </ItemActions>
      )}
    </Item>
  );
}
