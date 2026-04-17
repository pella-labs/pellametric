// @bematist/ui — shared UI primitives for the Bematist dashboard.
// Dark mode default, WCAG AA target, every chart has a table toggle.

export type { BrandColor } from "../brand.config";
export { brand } from "../brand.config";
// Charts
export {
  AreaChart,
  type AreaChartDatum,
  type AreaChartFormat,
  type AreaChartProps,
} from "./charts/AreaChart";
export { ChartTableToggle } from "./charts/ChartTableToggle";
export {
  ScatterChart,
  type ScatterChartProps,
  type ScatterDatum,
} from "./charts/ScatterChart";
// Components
export { Badge, type BadgeProps } from "./components/Badge";
export { Button, type ButtonProps, buttonVariants } from "./components/Button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardValue,
} from "./components/Card";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "./components/Dialog";
export { Input, Textarea } from "./components/Input";
export { Skeleton } from "./components/Skeleton";
export { ScrollArea, ScrollBar } from "./components/scroll-area";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "./components/Tooltip";
export { cn } from "./lib/cn";
// Motion
export { fadeIn, slideUp, stagger } from "./motion/presets";
// Privacy
export { type Confidence, ConfidenceBadge } from "./privacy/ConfidenceBadge";
export { CostEstimatedChip } from "./privacy/CostEstimatedChip";
export { type Fidelity, FidelityChip } from "./privacy/FidelityChip";
export {
  type GateReason,
  InsufficientData,
} from "./privacy/InsufficientData";
export {
  RedactedChip,
  type RedactedChipProps,
  renderWithRedactions,
} from "./privacy/RedactedChip";
export {
  type ActionResultLike,
  RevealDialog,
  type RevealDialogProps,
} from "./privacy/RevealDialog";
export {
  findMarkers,
  type MarkerMatch,
  REDACTION_MARKER_REGEX,
  type RedactionType,
} from "./privacy/redactionMarker";
// Tables
export {
  type ColumnDef,
  VirtualTable,
  type VirtualTableProps,
} from "./tables/VirtualTable";
