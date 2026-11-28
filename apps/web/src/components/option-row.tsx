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
}: {
  title: string;
  description: string;
  media: React.ReactNode;
  mediaVariant?: "default" | "icon" | "muted";
  render?: useRender.RenderProp;
}) {
  return (
    <Item variant="outline" className="text-left" render={render}>
      <ItemMedia variant={mediaVariant}>{media}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ChevronRightIcon absoluteStrokeWidth />
      </ItemActions>
    </Item>
  );
}
