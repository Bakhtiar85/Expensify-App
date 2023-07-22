/* eslint-disable es/no-optional-chaining */
import React, {useContext, useEffect, useRef, useState, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import PropTypes from 'prop-types';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
    cancelAnimation,
    runOnJS,
    runOnUI,
    useAnimatedReaction,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    useWorkletCallback,
    withDecay,
    withSpring,
} from 'react-native-reanimated';
import styles from '../../../../styles/styles';
import AttachmentCarouselPagerContext from './AttachmentCarouselPagerContext';
import ImageWrapper from './ImageWrapper';

const DEFAULT_INITIAL_SCALE = 1;
const MAX_SCALE = 20;
const MIN_SCALE = 0.7;
const DOUBLE_TAP_SCALE = 3;

const SPRING_CONFIG = {
    mass: 3,
    stiffness: 1000,
    damping: 500,
};

function clamp(value, lowerBound, upperBound) {
    'worklet';

    return Math.min(Math.max(lowerBound, value), upperBound);
}

const imageTransformerPropTypes = {
    imageWidth: PropTypes.number,
    imageHeight: PropTypes.number,
    imageScale: PropTypes.number,
    scaledImageWidth: PropTypes.number,
    scaledImageHeight: PropTypes.number,
    isActive: PropTypes.bool.isRequired,
    children: PropTypes.node.isRequired,
};

const imageTransformerDefaultProps = {
    imageWidth: 0,
    imageHeight: 0,
    imageScale: 1,
    scaledImageWidth: 0,
    scaledImageHeight: 0,
};

function ImageTransformer({imageWidth, imageHeight, imageScale, scaledImageWidth, scaledImageHeight, isActive, children}) {
    const {canvasWidth, canvasHeight, onTap, onSwipe, onSwipeSuccess, pagerRef, shouldPagerScroll, isScrolling, onPinchGestureChange} = useContext(AttachmentCarouselPagerContext);

    const initialScale = useMemo(() => DEFAULT_INITIAL_SCALE * imageScale, [imageScale]);
    const minScale = useMemo(() => MIN_SCALE * imageScale, [imageScale]);
    const maxScale = useMemo(() => MAX_SCALE * imageScale, [imageScale]);
    const doubleTapScale = useMemo(() => DOUBLE_TAP_SCALE * imageScale, [imageScale]);

    const zoomScale = useSharedValue(1);
    // Adding together the pinch zoom scale and the initial scale to fit the image into the canvas
    // Substracting 1, because both scales have the initial image as the base reference
    const totalScale = useDerivedValue(() => Math.max(zoomScale.value + initialScale - 1, 0), []);

    const zoomScaledImageWidth = useDerivedValue(() => imageWidth * totalScale.value, [imageWidth]);
    const zoomScaledImageHeight = useDerivedValue(() => imageHeight * totalScale.value, [imageHeight]);

    // used for pan gesture
    const translateY = useSharedValue(0);
    const translateX = useSharedValue(0);
    const offsetX = useSharedValue(0);
    const offsetY = useSharedValue(0);
    const isSwiping = useSharedValue(false);

    // used for moving fingers when pinching
    const scaleTranslateX = useSharedValue(0);
    const scaleTranslateY = useSharedValue(0);

    // storage for the the origin of the gesture
    const origin = {
        x: useSharedValue(0),
        y: useSharedValue(0),
    };

    // storage for the pan velocity to calculate the decay
    const panVelocityX = useSharedValue(0);
    const panVelocityY = useSharedValue(0);

    // store scale in between gestures
    const scaleOffset = useSharedValue(1);

    // disable pan vertically when image is smaller than screen
    const canPanVertically = useDerivedValue(() => canvasHeight < zoomScaledImageHeight.value, [canvasHeight]);

    // calculates bounds of the scaled image
    // can we pan left/right/up/down
    // can be used to limit gesture or implementing tension effect
    const getBounds = useWorkletCallback(() => {
        const rightBoundary = Math.abs(canvasWidth - zoomScaledImageWidth.value) / 2;

        let topBoundary = 0;

        if (canvasHeight < zoomScaledImageHeight.value) {
            topBoundary = Math.abs(zoomScaledImageHeight.value - canvasHeight) / 2;
        }

        const maxVector = {x: rightBoundary, y: topBoundary};
        const minVector = {x: -rightBoundary, y: -topBoundary};

        const target = {
            x: clamp(offsetX.value, minVector.x, maxVector.x),
            y: clamp(offsetY.value, minVector.y, maxVector.y),
        };

        const isInBoundaryX = target.x === offsetX.value;
        const isInBoundaryY = target.y === offsetY.value;

        return {
            target,
            isInBoundaryX,
            isInBoundaryY,
            minVector,
            maxVector,
            canPanLeft: target.x < maxVector.x,
            canPanRight: target.x > minVector.x,
        };
    }, [canvasWidth, canvasHeight]);

    const afterGesture = useWorkletCallback(() => {
        const {target, isInBoundaryX, isInBoundaryY, minVector, maxVector} = getBounds();

        if (!canPanVertically.value) {
            offsetY.value = withSpring(target.y, SPRING_CONFIG);
        }

        if (
            zoomScale.value === 1 &&
            offsetX.value === 0 &&
            offsetY.value === 0 &&
            translateX.value === 0 &&
            translateY.value === 0 &&
            scaleTranslateX.value === 0 &&
            scaleTranslateY.value === 0
        ) {
            // we don't need to run any animations
            return;
        }

        if (zoomScale.value <= 1) {
            // just center it
            // reset(true);
            offsetX.value = withSpring(0, SPRING_CONFIG);
            offsetY.value = withSpring(0, SPRING_CONFIG);
            return;
        }

        const deceleration = 0.9915;

        if (isInBoundaryX) {
            if (Math.abs(panVelocityX.value) > 0 && zoomScale.value <= maxScale) {
                offsetX.value = withDecay({
                    velocity: panVelocityX.value,
                    clamp: [minVector.x, maxVector.x],
                    deceleration,
                    rubberBandEffect: false,
                });
            }
        } else {
            offsetX.value = withSpring(target.x, SPRING_CONFIG);
        }

        if (isInBoundaryY) {
            if (
                Math.abs(panVelocityY.value) > 0 &&
                zoomScale.value <= maxScale &&
                // limit vertical pan only when image is smaller than screen
                offsetY.value !== minVector.y &&
                offsetY.value !== maxVector.y
            ) {
                offsetY.value = withDecay({
                    velocity: panVelocityY.value,
                    clamp: [minVector.y, maxVector.y],
                    deceleration,
                });
            }
        } else {
            offsetY.value = withSpring(target.y, SPRING_CONFIG, () => {
                isSwiping.value = false;
            });
        }
    });

    const stopAnimation = useWorkletCallback(() => {
        cancelAnimation(offsetX);
        cancelAnimation(offsetY);
    });

    const zoomToCoordinates = useWorkletCallback(
        (x, y) => {
            'worklet';

            stopAnimation();

            const usableImage = {
                x: scaledImageWidth,
                y: scaledImageHeight,
            };

            const targetImageSize = {
                x: usableImage.x * DOUBLE_TAP_SCALE,
                y: usableImage.y * DOUBLE_TAP_SCALE,
            };

            const CENTER = {
                x: canvasWidth / 2,
                y: canvasHeight / 2,
            };

            const imageCenter = {
                x: usableImage.x / 2,
                y: usableImage.y / 2,
            };

            const focal = {x, y};

            const currentOrigin = {
                x: (targetImageSize.x / 2 - CENTER.x) * -1,
                y: (targetImageSize.y / 2 - CENTER.y) * -1,
            };

            const koef = {
                x: (1 / imageCenter.x) * focal.x - 1,
                y: (1 / imageCenter.y) * focal.y - 1,
            };

            const target = {
                x: currentOrigin.x * koef.x,
                y: currentOrigin.y * koef.y,
            };

            if (targetImageSize.y < canvasHeight) {
                target.y = 0;
            }

            offsetX.value = withSpring(target.x, SPRING_CONFIG);
            offsetY.value = withSpring(target.y, SPRING_CONFIG);
            zoomScale.value = withSpring(doubleTapScale, SPRING_CONFIG);
            scaleOffset.value = doubleTapScale;
        },
        [scaledImageWidth, scaledImageHeight, canvasWidth, canvasHeight],
    );

    const reset = useWorkletCallback((animated) => {
        scaleOffset.value = 1;

        stopAnimation();

        if (animated) {
            offsetX.value = withSpring(0, SPRING_CONFIG);
            offsetY.value = withSpring(0, SPRING_CONFIG);
            zoomScale.value = withSpring(1, SPRING_CONFIG);
        } else {
            zoomScale.value = 1;
            translateX.value = 0;
            translateY.value = 0;
            offsetX.value = 0;
            offsetY.value = 0;
            scaleTranslateX.value = 0;
            scaleTranslateY.value = 0;
        }
    });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(150)
        .maxDistance(20)
        .onEnd((evt) => {
            if (zoomScale.value > 1) {
                reset(true);
            } else {
                zoomToCoordinates(evt.x, evt.y);
            }
        });

    const panGestureRef = useRef(Gesture.Pan());

    const singleTap = Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(50)
        .requireExternalGestureToFail(doubleTap, panGestureRef)
        .onBegin(() => {
            stopAnimation();
        })
        .onFinalize((evt, success) => {
            if (!success || !onTap) return;

            runOnJS(onTap)();
        });

    const previousTouch = useSharedValue(null);

    const panGesture = Gesture.Pan()
        .manualActivation(true)
        .averageTouches(true)
        .onTouchesMove((evt, state) => {
            if (zoomScale.value > 1) {
                state.activate();
            }

            // TODO: Swipe down to close carousel gesture
            // this needs fine tuning to work properly
            // if (!isScrolling.value && scale.value === 1 && previousTouch.value != null) {
            //     const velocityX = Math.abs(evt.allTouches[0].x - previousTouch.value.x);
            //     const velocityY = evt.allTouches[0].y - previousTouch.value.y;

            //     // TODO: this needs tuning
            //     if (Math.abs(velocityY) > velocityX && velocityY > 20) {
            //         state.activate();

            //         isSwiping.value = true;
            //         previousTouch.value = null;

            //         runOnJS(onSwipeDown)();
            //         return;
            //     }
            // }

            if (previousTouch.value == null) {
                previousTouch.value = {
                    x: evt.allTouches[0].x,
                    y: evt.allTouches[0].y,
                };
            }
        })
        .simultaneousWithExternalGesture(pagerRef, doubleTap, singleTap)
        .onBegin(() => {
            stopAnimation();
        })
        .onChange((evt) => {
            // since we running both pinch and pan gesture handlers simultaneously
            // we need to make sure that we don't pan when we pinch and move fingers
            // since we track it as pinch focal gesture
            if (evt.numberOfPointers > 1 || isScrolling.value) {
                return;
            }

            panVelocityX.value = evt.velocityX;

            panVelocityY.value = evt.velocityY;

            if (!isSwiping.value) {
                translateX.value += evt.changeX;
            }

            if (canPanVertically.value || isSwiping.value) {
                translateY.value += evt.changeY;
            }
        })
        .onEnd((evt) => {
            previousTouch.value = null;

            if (isScrolling.value) {
                return;
            }

            offsetX.value += translateX.value;
            offsetY.value += translateY.value;
            translateX.value = 0;
            translateY.value = 0;

            if (isSwiping.value) {
                const enoughVelocity = Math.abs(evt.velocityY) > 300 && Math.abs(evt.velocityX) < Math.abs(evt.velocityY);
                const rightDirection = (evt.translationY > 0 && evt.velocityY > 0) || (evt.translationY < 0 && evt.velocityY < 0);

                if (enoughVelocity && rightDirection) {
                    const maybeInvert = (v) => {
                        const invert = evt.velocityY < 0;
                        return invert ? -v : v;
                    };

                    offsetY.value = withSpring(
                        maybeInvert(imageHeight * 2),
                        {
                            stiffness: 50,
                            damping: 30,
                            mass: 1,
                            overshootClamping: true,
                            restDisplacementThreshold: 300,
                            restSpeedThreshold: 300,
                            velocity: Math.abs(evt.velocityY) < 1200 ? maybeInvert(1200) : evt.velocityY,
                        },
                        () => {
                            runOnJS(onSwipeSuccess)();
                        },
                    );
                    return;
                }
            }

            afterGesture();

            panVelocityX.value = 0;
            panVelocityY.value = 0;
        })
        .withRef(panGestureRef);

    const getAdjustedFocal = useWorkletCallback(
        (focalX, focalY) => ({
            x: focalX - (canvasWidth / 2 + offsetX.value),
            y: focalY - (canvasHeight / 2 + offsetY.value),
        }),
        [canvasWidth, canvasHeight],
    );

    // used to store event scale value when we limit scale
    const gestureScale = useSharedValue(1);

    const pinchGestureRunning = useSharedValue(false);
    const pinchGesture = Gesture.Pinch()
        .onTouchesDown((evt, state) => {
            // we don't want to activate pinch gesture when we are scrolling pager
            if (!isScrolling.value) return;

            state.fail();
        })
        .simultaneousWithExternalGesture(panGesture, doubleTap)
        .onStart((evt) => {
            pinchGestureRunning.value = true;

            stopAnimation();

            const adjustFocal = getAdjustedFocal(evt.focalX, evt.focalY);

            origin.x.value = adjustFocal.x;
            origin.y.value = adjustFocal.y;
        })
        .onChange((evt) => {
            zoomScale.value = clamp(scaleOffset.value * evt.scale, minScale, maxScale);

            if (zoomScale.value > minScale && zoomScale.value < maxScale) {
                gestureScale.value = evt.scale;
            }

            const adjustFocal = getAdjustedFocal(evt.focalX, evt.focalY);

            scaleTranslateX.value = adjustFocal.x + gestureScale.value * origin.x.value * -1;
            scaleTranslateY.value = adjustFocal.y + gestureScale.value * origin.y.value * -1;
        })
        .onEnd(() => {
            offsetX.value += scaleTranslateX.value;
            offsetY.value += scaleTranslateY.value;
            scaleTranslateX.value = 0;
            scaleTranslateY.value = 0;
            scaleOffset.value = zoomScale.value;
            gestureScale.value = 1;

            if (scaleOffset.value < 1) {
                // make sure we don't add stuff below the 1
                scaleOffset.value = 1;

                // this runs the timing animation
                zoomScale.value = withSpring(1, SPRING_CONFIG);
            } else if (scaleOffset.value > maxScale) {
                scaleOffset.value = maxScale;
                zoomScale.value = withSpring(maxScale, SPRING_CONFIG);
            }

            afterGesture();

            pinchGestureRunning.value = false;
        });

    const [isPinchGestureInUse, setIsPinchGestureInUse] = useState(false);
    useAnimatedReaction(
        () => [zoomScale.value, pinchGestureRunning.value],
        ([zoom, running]) => {
            const newIsPinchGestureInUse = zoom !== 1 || running;
            if (isPinchGestureInUse !== newIsPinchGestureInUse) {
                runOnJS(setIsPinchGestureInUse)(newIsPinchGestureInUse);
            }
        },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => onPinchGestureChange(isPinchGestureInUse), [isPinchGestureInUse]);

    const animatedStyles = useAnimatedStyle(() => {
        const x = scaleTranslateX.value + translateX.value + offsetX.value;
        const y = scaleTranslateY.value + translateY.value + offsetY.value;

        if (isSwiping.value) {
            onSwipe(y);
        }

        return {
            transform: [
                {
                    translateX: x,
                },
                {
                    translateY: y,
                },
                {scale: totalScale.value},
            ],
        };
    }, []);

    // reacts to scale change and enables/disables pager scroll
    useAnimatedReaction(
        () => zoomScale.value,
        () => {
            shouldPagerScroll.value = zoomScale.value === 1;
        },
    );

    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            return;
        }

        if (!isActive) {
            runOnUI(reset)(false);
        }
    }, [isActive, mounted, reset]);

    return (
        <View
            collapsable={false}
            style={[
                styles.flex1,
                {
                    width: canvasWidth,
                },
            ]}
        >
            <GestureDetector gesture={pinchGesture}>
                <Animated.View
                    collapsable
                    style={StyleSheet.absoluteFill}
                >
                    <GestureDetector gesture={Gesture.Race(pinchGesture, singleTap, panGesture)}>
                        <Animated.View
                            collapsable
                            style={StyleSheet.absoluteFill}
                        >
                            <ImageWrapper>
                                <GestureDetector gesture={doubleTap}>
                                    <Animated.View
                                        collapsable={false}
                                        style={[animatedStyles]}
                                    >
                                        {children}
                                    </Animated.View>
                                </GestureDetector>
                            </ImageWrapper>
                        </Animated.View>
                    </GestureDetector>
                </Animated.View>
            </GestureDetector>
        </View>
    );
}
ImageTransformer.propTypes = imageTransformerPropTypes;
ImageTransformer.defaultProps = imageTransformerDefaultProps;

export default ImageTransformer;
