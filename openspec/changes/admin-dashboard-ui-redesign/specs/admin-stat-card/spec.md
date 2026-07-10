## ADDED Requirements

### Requirement: AdminStat card uses clean layout without accent bar
The AdminStat card SHALL NOT render a left-side chromatic accent bar. Instead, it SHALL use a clean layout with the value as the primary visual element.

#### Scenario: AdminStat renders without accent bar
- **WHEN** an AdminStat card is rendered
- **THEN** there SHALL be no left-side colored bar element

### Requirement: AdminStat displays percentage badge
The AdminStat card SHALL display a percentage change badge (delta chip) positioned to the right of the value, with an arrow icon indicating direction.

#### Scenario: AdminStat shows positive change
- **WHEN** an AdminStat card renders with a positive trend
- **THEN** a green-tinted badge with upward arrow and percentage SHALL appear

#### Scenario: AdminStat shows negative change
- **WHEN** an AdminStat card renders with a negative trend
- **THEN** a red-tinted badge with downward arrow and percentage SHALL appear

### Requirement: AdminStat icon uses muted background
The AdminStat card icon SHALL render inside a `bg-muted/40` rounded container instead of a tone-colored background.

#### Scenario: AdminStat icon styling
- **WHEN** an AdminStat card is rendered
- **THEN** the icon SHALL be inside a muted background rounded rectangle

### Requirement: AdminStat preserves sparkline
The AdminStat card SHALL continue to display an optional sparkline below the value, maintaining the existing trend visualization.

#### Scenario: AdminStat with trend data
- **WHEN** an AdminStat card receives a `trend` prop with 2+ data points
- **THEN** a sparkline SHALL render below the value

### Requirement: AdminStat loading state
The AdminStat card SHALL show a pulsing placeholder during loading, maintaining the same layout dimensions to prevent reflow.

#### Scenario: AdminStat loading
- **WHEN** an AdminStat card is in loading state
- **THEN** the value area SHALL show a pulsing skeleton placeholder
