// Adapted from shadcn/ui new-york-v4 (MIT): local tokens replace utility styling.
import * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {Slot} from 'radix-ui';
import {cn} from '../../lib/utils';
import styles from './button.module.css';

const buttonVariants = cva(styles.button, {
  variants: {
    variant: {default: null, outline: null},
    size: {default: null, sm: null},
  },
  defaultVariants: {variant: 'default', size: 'default'},
});
function Button({className, variant = 'default', size = 'default', asChild = false, ...props}:
  React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & {asChild?: boolean}) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({variant, size, className}))} {...props}/>;
}
export {Button, buttonVariants};
