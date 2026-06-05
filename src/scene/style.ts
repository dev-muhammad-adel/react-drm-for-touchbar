export interface Style {
  display?: 'block' | 'flex' | 'grid';

  // Flex container
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  flexWrap?: 'nowrap' | 'wrap';
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';

  // Grid container
  gridTemplateColumns?: string;
  gridTemplateRows?: string;

  // Grid item
  gridColumn?: number | string;
  gridRow?: number | string;

  // Positioning
  position?: 'static' | 'relative' | 'absolute';
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;

  // Dimensions (override node width/height props when set)
  width?: number;
  height?: number;

  // Padding (shrinks the content area inside the box)
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}
