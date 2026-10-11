/** Restrained side-elevation recognition profiles, on a 240 x 90 canvas.
 * Long chassis/hulls, narrow barrels and subdued internal cuts avoid toy icons.
 */
const cut = d => `<path d="${d}" fill="#292b24" stroke="none"/>`
const tire = (x,y,r=9) => `<circle cx="${x}" cy="${y}" r="${r}"/>`
const truck = `<path d="M24 35 30 25H139L147 34V62H24ZM145 42 150 28H176L188 44 211 48 216 62H144ZM20 59H219V67H20ZM201 48V43H207V49Z"/>${cut('M154 33H173L182 44H152ZM26 59H138V61H26ZM185 47H188V59H185Z')}${tire(45,69)}${tire(75,69)}${tire(193,69)}<path d="M25 34H144M47 28V58M77 28V58M107 28V58" fill="none" stroke="#292b24" stroke-width="1"/>`
const tank = `<path d="M23 54 33 42 162 40 185 50 192 59 181 70H29ZM67 41 72 27 86 23H119L137 29 144 42ZM90 23V18H111V23ZM133 29 229 25V30L136 35ZM41 41V35H66V41Z"/><path d="M34 59H178L187 67 178 78H33L22 68Z"/>${cut('M35 63H175L180 67 173 73H37L29 68Z')}<path d="M38 67H174" fill="none" stroke="currentColor" stroke-width="5"/><path d="M27 53H184M73 39H136" fill="none" stroke="#292b24" stroke-width="1.3"/>`
const artillery = `<path d="M24 74 112 52 124 55 45 77ZM102 53 107 31 117 21 134 25 139 51 131 61H114ZM122 30 223 15 226 20 132 37ZM118 54 180 76H194V79H171L117 62Z"/>${tire(121,65,14)}${cut('M113 65a8 8 0 1 0 16 0a8 8 0 1 0-16 0')}<circle cx="121" cy="65" r="3"/>`
const flak = `<path d="M100 66V44H121V66ZM91 46 96 31 106 26 124 35 126 48 114 56ZM109 33 174 1 177 5 116 40ZM99 65 51 77H39V81H63L111 71 165 81H190V77H171L122 65ZM111 60H133V65H111ZM80 49H96V53H80Z"/><path d="M87 50V66M134 48V69M87 66H98M131 69H141" fill="none" stroke="currentColor" stroke-width="3"/>`
const halftrack = `<path d="M24 42 33 33H124V49H137V32H164L177 46 202 49 209 63H24ZM74 34V24H97V37ZM84 26 61 2 65 0 90 24ZM88 26 69 2 73 0 94 24Z"/>${cut('M144 37H161L169 47H142ZM33 40H70V45H33')}<path d="M34 62H121L129 69 121 79H34L25 70Z"/>${cut('M38 67H118L122 70 116 74H38L32 70Z')}<path d="M41 70H114" fill="none" stroke="currentColor" stroke-width="4"/>${tire(183,69,11)}`
const warship = `<path d="M5 65 233 61 225 73 28 77 13 73ZM35 61V55H49V61ZM176 60V54H190V60ZM55 60V49H75V60ZM83 59V43H107V59ZM93 43V37H108V44ZM118 60V42H128V60ZM145 60V44H153V60ZM158 59V52H174V60ZM186 54 216 50V52L190 56ZM47 55 21 51V49L48 53Z"/><path d="M98 38V10M82 24H117M87 18H109M159 51V25M149 34H169M98 12 72 48M99 12 126 49M159 26 179 54" fill="none" stroke="currentColor" stroke-width="1.5"/>${cut('M24 68H219V69H24')}`
const carrier = `<path d="M4 49H235L231 53H8ZM13 55H225L218 70 197 76H36L22 70ZM148 48V30H169V48ZM151 30V24H166V30ZM164 35H179V47H164ZM145 44H181V49H145Z"/><path d="M155 25V9M145 17H170M169 34V16M159 20H178" fill="none" stroke="currentColor" stroke-width="1.5"/>${cut('M26 60H211V62H26M43 68H190V70H43')}`
const parkedBomber = `<path d="M13 51 24 20H38L49 50 77 48 89 42H137L151 46 198 46 221 50 232 56 224 61 53 61 16 56H5V53ZM91 51 126 27H141L127 51ZM83 58 142 72H119L64 60Z"/><path d="M85 61V73M150 61V72M32 60V70" fill="none" stroke="currentColor" stroke-width="2"/>${tire(85,76,4)}${tire(150,75,4)}${tire(32,73,3)}${cut('M95 46H130V49H95')}`
const parkedFighter = `<path d="M13 54 23 23H35L48 53 96 50 109 39H134L153 49 203 52 226 58 218 63H49L12 58ZM90 59 141 73H124L70 62Z"/><path d="M220 42V73M113 63V76M35 63V73" fill="none" stroke="currentColor" stroke-width="2"/>${tire(113,78,4)}${tire(35,75,3)}${cut('M111 43H131L141 50H103Z')}`

export function briefingSilhouette(kind) {
  const shapes = { truck, tank, artillery, flak, halftrack, warship, carrier, parkedBomber, parkedFighter }
  if (!shapes[kind]) throw new Error(`Unknown briefing silhouette: ${kind}`)
  return `<g transform="translate(-78 -29) scale(.65)" stroke-width=".8" stroke-linejoin="miter">${shapes[kind]}</g>`
}
