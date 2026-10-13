import { describe, expect, it } from 'vitest'
import { locate, plateLabel } from './place.js'

describe('subpoint place', () => {
    it('names the country and state under a fix', () => {
        expect(locate(34.0522, -118.2437)).toEqual({ country: 'United States', state: 'California' })
        expect(locate(40.7128, -74.006)).toEqual({ country: 'United States', state: 'New York' })
        expect(locate(51.5074, -0.1278)).toEqual({ country: 'United Kingdom', state: 'England' })
        expect(locate(48.8566, 2.3522)).toEqual({ country: 'France', state: 'Île-de-France' })
        expect(locate(-33.8688, 151.2093)).toEqual({ country: 'Australia', state: 'New South Wales' })
    })

    it('leaves open ocean blank', () => {
        expect(locate(0, 0)).toEqual({ country: null, state: null })
    })

    it('folds names into the CRT alphabet', () => {
        expect(plateLabel('Île-de-France')).toBe('ILE-DE-FRANCE')
        expect(plateLabel(null)).toBe('--')
        expect(plateLabel('')).toBe('--')
    })
})
