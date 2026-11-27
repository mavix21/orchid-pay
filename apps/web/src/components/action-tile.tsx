import { useRender } from "@base-ui/react/use-render";

export function ActionTile({
  label,
  icon,
  render = <button type="button" />,
}: {
  label: string;
  icon: React.ReactNode;
  render?: useRender.RenderProp;
}) {
  return useRender({
    render,
    props: {
      className:
        "group/tile flex flex-1 flex-col items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      children: (
        <>
          <span className="flex h-14 w-full items-center justify-center rounded-lg bg-accent text-icon-accent transition duration-150 ease-out group-hover/tile:bg-accent-pressed group-active/tile:scale-97 group-active/tile:bg-accent-pressed [&_svg]:size-6">
            {icon}
          </span>
          <span className="text-label">{label}</span>
        </>
      ),
    },
  });
}
