/** Numeric pixels or a percentage of the parent, e.g. 120 or '50%'. */
export type Dimension = number | `${number}%`;

export interface Style {
  display?: 'flex' | 'block' | 'none';

  // Flex container
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  /** Distribution of wrapped lines along the cross axis (pairs with flexWrap). */
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around';
  flexWrap?: 'nowrap' | 'wrap';
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  // Flex item
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Dimension | 'auto';
  flex?: number; // shorthand: sets flexGrow (and flexBasis: 0)
  /** width / height. Constrains the missing dimension when only one is set. */
  aspectRatio?: number;

  // Positioning
  position?: 'relative' | 'absolute' | 'static';
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;

  // Dimensions (override node width/height props when set)
  width?: Dimension;
  height?: Dimension;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;

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

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';

  // Text
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;

  zIndex?: number;

  // Visual
  overflow?: 'visible' | 'hidden' | 'scroll';
  opacity?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  shadowRadius?: number;
  /** Draw the shadow inside the box (recessed) instead of as an outer drop. */
  shadowInset?: boolean;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;

  /** Rotation in degrees about the box center. Visual only — does not affect layout. */
  rotate?: number;
}
