import { describe, it, expect } from 'vitest'
import { readCoords } from './mapCoords'

describe('readCoords', () => {
  it.each([
    [[48.2, 16.4], [48.2, 16.4]],
    ['48.2,16.4', [48.2, 16.4]],
    [' 48.2 , -16.4 ', [48.2, -16.4]],
    [['48.2', '16.4'], [48.2, 16.4]],
    [[90, 180], [90, 180]],
    [[91, 0], null],
    [[0, 181], null],
    ['x', null],
    ['48.2', null],
    ['48.2,16.4,3', null],
    [[48.2], null],
    [[null, 1], null],
    [['a', 'b'], null],
    [null, null],
    [undefined, null],
    [{ lat: 1, lng: 2 }, null],
  ])('%j → %j', (value, expected) => {
    expect(readCoords(value)).toEqual(expected)
  })
})
