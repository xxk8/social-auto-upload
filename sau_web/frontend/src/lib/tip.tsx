import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/Components/ui/tooltip'

/** Reusable tooltip wrapper used by AiSidebar, AiPanelToolbar, etc. */
export function Tip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
