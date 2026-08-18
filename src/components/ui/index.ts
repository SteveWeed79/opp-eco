/**
 * Component library.
 *
 * A single import surface for every reusable piece, so call sites never reach
 * into individual files and the internal layout can change without a sweep.
 *
 *   Modal      accessible dialog — focus trap, Escape, scroll lock
 *   Field      labelled form controls with announced errors
 *   Feedback   toasts, empty states, and assumption markers
 *   primitives surfaces, badges, buttons, tables, stats
 */

export { Modal, type ModalProps } from "./Modal";

export {
  TextField,
  TextAreaField,
  SelectField,
  ChoiceGroup,
} from "./Field";

export {
  ToastProvider,
  useToast,
  type Toast,
  type ToastTone,
} from "./Feedback";

export {
  Card,
  CardHeader,
  PageHeader,
  PageSection,
  Stat,
  Badge,
  TrackBadge,
  StatusBadge,
  DwellBadge,
  STATUS_META,
  Button,
  TableWrap,
  Th,
  Td,
  Empty,
  Assumption,
  Money,
  ProgressBar,
} from "./primitives";

export { ConfirmDialog } from "./ConfirmDialog";
export { DataTable, type Column } from "./DataTable";
export { Tabs, type TabDefinition } from "./Tabs";
export { Combobox } from "./Combobox";
export { SlotPicker, type Slot } from "./SlotPicker";
export { FileUpload, type AttachedFile } from "./FileUpload";
export { Avatar, PersonChip } from "./Person";
export { Timeline, type TimelineEntry } from "./Timeline";
export { Pagination, paginate } from "./Pagination";
export { Skeleton, SkeletonText, SkeletonCard, SkeletonRows } from "./Skeleton";
