export interface Style {
  display?: 'flex' | 'grid' | 'block' | 'none';

  // Flex container
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  flexWrap?: 'nowrap' | 'wrap';
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  // Flex item
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  flex?: number; // shorthand: sets flexGrow (and flexBasis: 0)

  // Grid container
  gridTemplateColumns?: string;
  gridTemplateRows?: string;

  // Grid item
  gridColumn?: number | string;
  gridRow?: number | string;

  // Positioning
  position?: 'relative' | 'absolute' | 'static';
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;

  // Dimensions (override node width/height props when set)
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // Padding (shrinks the content area inside the box)
  padding?: number;
  paddingHorizontal?: number;
  paddingVertical?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;

  // Margin (space outside the box, respected by flex parent)
  margin?: number;
  marginHorizontal?: number;
  marginVertical?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;

  // Visual
  overflow?: 'visible' | 'hidden';
  opacity?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  shadowRadius?: number;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;
}
