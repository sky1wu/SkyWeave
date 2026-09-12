/** An abstract city route, deliberately separate from the live itinerary map. */
export function JourneyArt({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`journey-art ${className}`}
      viewBox="0 0 600 400"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M422-30C340 70 530 96 447 203S378 310 501 436"
        stroke="currentColor"
        strokeWidth="66"
        className="art-river"
      />
      <g stroke="currentColor" strokeWidth="2" className="art-streets">
        <path d="M-30 90H265L365 190H650M-20 330H203L300 233H635M110-20V230L200 320V430M325-20V92L211 206H-20M550-20V132L491 191V430" />
        <path d="M-20 151H145L237 59H640M28-20V400M260 420V345L372 233V-20" />
      </g>
      <rect
        x="53"
        y="184"
        width="96"
        height="102"
        rx="28"
        className="art-park"
      />
      <rect
        x="364"
        y="47"
        width="74"
        height="57"
        rx="18"
        className="art-park"
      />
      <g stroke="currentColor" strokeWidth="2" className="art-trees">
        <path d="M79 213v22m-9-9 9-14 9 14H70Zm42 20v23m-9-9 9-14 9 14h-18Z" />
      </g>
      <path
        d="M80 114H201Q217 114 229 126L299 196Q311 208 311 225V277Q311 294 329 294H495"
        className="art-route-shadow"
        strokeWidth="15"
        strokeLinecap="round"
      />
      <path
        d="M80 114H201Q217 114 229 126L299 196Q311 208 311 225V277Q311 294 329 294H495"
        className="art-route"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g className="art-stop" strokeWidth="5">
        <circle cx="80" cy="114" r="9" />
        <circle cx="257" cy="154" r="9" />
        <circle cx="311" cy="251" r="9" />
      </g>
      <circle cx="495" cy="294" r="21" className="art-destination" />
      <path
        d="m487 294 6 6 11-13"
        stroke="#18324B"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="art-label">
        <rect x="46" y="61" width="69" height="30" rx="15" />
        <text x="80" y="81" textAnchor="middle">
          出发
        </text>
        <rect x="219" y="178" width="76" height="30" rx="15" />
        <text x="257" y="198" textAnchor="middle">
          逛一逛
        </text>
        <rect x="454" y="331" width="84" height="30" rx="15" />
        <text x="496" y="351" textAnchor="middle">
          下一站
        </text>
      </g>
    </svg>
  );
}
