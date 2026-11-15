'use strict';
/**
 * TVEC Accreditation Format T-1 (Scheme of Training) & Format T-2 (B. Presentation / Lesson Plan)
 * Covers all 12 Core Modules (M01 - M12) of NCS K72S004 (ICT Technician NVQ Level 4),
 * intentionally excluding Basic Modules (BM01 - BM04).
 *
 * Designed to be 100% REUSABLE across batches and accreditation inspections:
 *  - Uses relative Month numbers (1 - 6) and relative Week numbers (1 - 23) instead of exact calendar dates.
 *  - Leaves Date of Prepared / Date of Revised blank for reusable inspection binders.
 */
const zlib = require('zlib');
const db = require('../db');
const XLSX_TEMPLATE = require('../data/tvecXlsxTemplate.json');

function fmtHrs(h) {
  const n = Number(h);
  if (Number.isInteger(n)) {
    return `${String(n).padStart(2, '0')} ${n === 1 ? 'Hr' : 'Hrs'}`;
  }
  const clean = Number(n.toFixed(2));
  return `${clean} ${clean === 1 ? 'Hr' : 'Hrs'}`;
}

/**
 * Compute 7-step TVEC T-2 time breakdown in Hours (and Minutes)
 * so that all 7 steps sum to exact task hours (and minutes).
 */
function splitT2Hours(totalMinutes) {
  const H = Math.max(1, Math.round((totalMinutes / 60) * 4) / 4);
  const presets = {
    2:  { intro: 0.25, theory: 0.25, demo: 0.25, guided: 0.25, individual: 0.5,  evaluation: 0.25, feedback: 0.25, total: 2 },
    3:  { intro: 0.25, theory: 0.5,  demo: 0.5,  guided: 0.5,  individual: 0.75, evaluation: 0.25, feedback: 0.25, total: 3 },
    6:  { intro: 0.5,  theory: 1.0,  demo: 1.0,  guided: 1.0,  individual: 1.5,  evaluation: 0.5,  feedback: 0.5,  total: 6 },
    9:  { intro: 0.5,  theory: 1.5,  demo: 1.5,  guided: 2.0,  individual: 2.0,  evaluation: 1.0,  feedback: 0.5,  total: 9 },
    12: { intro: 0.5,  theory: 2.0,  demo: 2.0,  guided: 2.5,  individual: 3.5,  evaluation: 1.0,  feedback: 0.5,  total: 12 },
    15: { intro: 0.5,  theory: 2.5,  demo: 2.5,  guided: 3.0,  individual: 4.5,  evaluation: 1.5,  feedback: 0.5,  total: 15 },
    18: { intro: 1.0,  theory: 3.0,  demo: 3.0,  guided: 3.5,  individual: 5.0,  evaluation: 1.5,  feedback: 1.0,  total: 18 },
    24: { intro: 1.0,  theory: 3.5,  demo: 3.5,  guided: 5.5,  individual: 7.0,  evaluation: 2.5,  feedback: 1.0,  total: 24 },
    27: { intro: 1.0,  theory: 4.0,  demo: 4.0,  guided: 6.0,  individual: 8.0,  evaluation: 3.0,  feedback: 1.0,  total: 27 },
    30: { intro: 1.0,  theory: 4.5,  demo: 4.5,  guided: 6.5,  individual: 9.0,  evaluation: 3.5,  feedback: 1.0,  total: 30 }
  };
  if (presets[H]) return presets[H];

  const rHalf = (v) => Math.max(0.25, Math.round(v * 2) / 2);
  const intro = Math.min(1.0, rHalf(H * 0.05));
  const feedback = Math.min(1.0, rHalf(H * 0.05));
  const theory = rHalf(H * 0.16);
  const demo = rHalf(H * 0.16);
  const guided = rHalf(H * 0.22);
  const evaluation = rHalf(H * 0.12);
  const used = intro + theory + demo + guided + evaluation + feedback;
  const individual = Math.max(0.5, Math.round((H - used) * 4) / 4);
  return {
    intro, theory, demo, guided, individual, evaluation, feedback,
    total: intro + theory + demo + guided + individual + evaluation + feedback
  };
}

/**
 * Compute 7-step TVEC T-2 time breakdown (in minutes, multiples of 5)
 * that sums to totalMinutes:
 */
function splitT2Minutes(totalMinutes) {
  const M = Math.max(60, Math.round(totalMinutes / 5) * 5);
  if (M === 180) {
    return {
      intro: 10,
      theory: 15,
      demo: 25,
      guided: 40,
      individual: 50,
      evaluation: 35,
      feedback: 5,
      total: 180
    };
  }
  if (M === 360) {
    return {
      intro: 20,
      theory: 55,
      demo: 50,
      guided: 65,
      individual: 80,
      evaluation: 60,
      feedback: 30,
      total: 360
    };
  }
  if (M === 720) {
    return {
      intro: 20,
      theory: 60,
      demo: 110,
      guided: 180,
      individual: 250,
      evaluation: 70,
      feedback: 30,
      total: 720
    };
  }

  const round5 = (v) => Math.max(5, Math.round(v / 5) * 5);
  const intro = Math.min(30, round5(M * 0.055));
  const feedback = Math.min(30, round5(M * 0.045));
  const theory = round5(M * 0.15);
  const demo = round5(M * 0.15);
  const guided = round5(M * 0.21);
  const evaluation = round5(M * 0.14);
  const used = intro + theory + demo + guided + evaluation + feedback;
  const individual = Math.max(15, M - used);

  return {
    intro,
    theory,
    demo,
    guided,
    individual,
    evaluation,
    feedback,
    total: intro + theory + demo + guided + individual + evaluation + feedback
  };
}

/**
 * Reusable TVEC T-1 & T-2 Master Definition for Core Modules M01 - M12
 * (Basic Modules BM01 - BM04 are excluded per TVEC Technical Subject Inspection format).
 */
const TVEC_CORE_MODULES = [
  {
    code: 'M01',
    headerTitle: 'M-01. Maintain Files & Folders',
    title: 'Maintaining files & folders',
    theoryHours: 18,
    practicalHours: 6,
    totalHours: 24,
    resources: [
      'USB Flash Drives - 15',
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'A1',
        title: 'Start up and turn off the computer',
        month: 1,
        week: '1',
        sessions: 1,
        minutes: 180,
        theory: [
          'Components of a computer system & protected power supply (UPS).',
          'Checking plugged power and peripheral cables properly.',
          'Standard boot-up & safe application termination sequence.',
          'Standard shutdown, restart, sleep & power option properties.',
          'Terminating non-responding applications using Task Manager.'
        ]
      },
      {
        code: 'A2',
        title: 'Perform basic configuration',
        month: 1,
        week: '1',
        sessions: 1,
        minutes: 180,
        theory: [
          'Identifying operating system edition, version & system information.',
          'Customizing desktop settings, date & time, colour and display resolution.',
          'Configuring keyboard language, regional settings & installing fonts.',
          'Installing and uninstalling application software safely.',
          'Using built-in OS Help functions to troubleshoot common issues.'
        ]
      },
      {
        code: 'A3',
        title: 'Maintain system using system tools',
        month: 1,
        week: '1',
        sessions: 1,
        minutes: 180,
        theory: [
          'Checking disk errors and health using standard system utilities.',
          'Taking system and data backups according to standard procedures.',
          'Managing local disk storage and Disk Cleanup tools.',
          'Managing Recycle Bin storage, recovery and permanent deletion.'
        ]
      },
      {
        code: 'A4',
        title: 'Perform text editing system',
        month: 1,
        week: '1',
        sessions: 1,
        minutes: 180,
        theory: [
          'Launching a text editing application and opening existing files.',
          'Creating, editing and formatting plain/rich text files.',
          'Saving files to a designated drive/directory path with proper naming.',
          'Closing text editing applications following standard procedures.'
        ]
      },
      {
        code: 'A5',
        title: 'Work with Icons on desktop',
        month: 1,
        week: '1',
        sessions: 1,
        minutes: 180,
        theory: [
          'Identifying, selecting, arranging and moving desktop icons.',
          'Opening files, folders and applications directly from the desktop.',
          'Creating desktop shortcuts and Start menu shortcuts as required.'
        ]
      },
      {
        code: 'A6',
        title: 'Work with windows',
        month: 1,
        week: '2',
        sessions: 1,
        minutes: 180,
        theory: [
          'Minimizing, maximizing, resizing, moving and closing windows.',
          'Tiling, cascading and splitting multiple open windows.',
          'Switching between active windows using taskbar and keyboard shortcuts.'
        ]
      },
      {
        code: 'A7',
        title: 'Manage files and a folder',
        month: 1,
        week: '2',
        sessions: 1,
        minutes: 180,
        theory: [
          'Hierarchical file system structure (Drives, Folders, Sub-folders & Files).',
          'Creating directories, sub-folders and applying common file extensions.',
          'Setting file and folder attributes (Read-only, Hidden, Archive).',
          'Selecting, renaming, copying, moving, deleting and restoring files/folders.',
          'Searching files using wildcards, date modified and content filters.',
          'Compressing (ZIP/RAR) and extracting archived folders and files.'
        ]
      },
      {
        code: 'A8',
        title: 'Manage antivirus software',
        month: 1,
        week: '2',
        sessions: 1,
        minutes: 180,
        theory: [
          'Configuring standard antivirus protection and real-time security settings.',
          'Scanning specific drives, USB storage devices, folders and files.',
          'Updating virus definitions and quarantine/removal procedures.'
        ]
      }
    ]
  },

  {
    code: 'M02',
    headerTitle: 'M-02. Perform Word Processing',
    title: 'Performing word processing',
    theoryHours: 24,
    practicalHours: 36,
    totalHours: 60,
    resources: [
      'A4 Sheets        - 45',
      'Printer          - 01',
      'Marker Pens      - 02'
    ],
    services: [
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'B1',
        title: 'Use a word processing application',
        month: 1,
        week: '2',
        sessions: 2,
        minutes: 360,
        theory: [
          'Creating new documents using default and built-in templates.',
          'Saving documents to designated locations with or without password protection.',
          'Saving documents in different file formats (.docx, .pdf, .rtf, .txt).',
          'Opening, closing documents and using built-in Help functions.'
        ]
      },
      {
        code: 'B2',
        title: 'Perform adjustment of word processor settings',
        month: 1,
        week: '2',
        sessions: 2,
        minutes: 360,
        theory: [
          'Displaying and hiding ribbons, toolbars, ruler and non-printing characters.',
          'Modifying application preferences: user info, file security and default save location.',
          'Configuring AutoCorrect and AutoSave recovery intervals.',
          'Setting up editing and proofing language preferences.'
        ]
      },
      {
        code: 'B3',
        title: 'Perform text processing operations',
        month: 1,
        week: '3',
        sessions: 2,
        minutes: 360,
        theory: [
          'Typing text, inserting special characters, symbols and AutoText entries.',
          'Inserting and removing paragraph marks and line break marks.',
          'Selecting characters, words, lines, sentences, paragraphs and full document.',
          'Editing, copying, moving and deleting text within and across documents.',
          'Searching and replacing words or phrases using Find & Replace.'
        ]
      },
      {
        code: 'B4',
        title: 'Format text and paragraph',
        month: 1,
        week: '3',
        sessions: 2,
        minutes: 360,
        theory: [
          'Changing font family, size, style, colour and character spacing.',
          'Setting paragraph alignment, first-line indent, line and paragraph spacing.',
          'Setting and clearing left, center, right and decimal tab stops.',
          'Defining and applying styles and using Format Painter.',
          'Applying single-level and multi-level bulleted and numbered lists.',
          'Adding borders and shading to paragraphs.'
        ]
      },
      {
        code: 'B5',
        title: 'Format a document',
        month: 1,
        week: '3',
        sessions: 2,
        minutes: 360,
        theory: [
          'Applying multi-column newspaper layouts to sections or whole documents.',
          'Changing page orientation (Portrait/Landscape), paper size and margins.',
          'Inserting and removing page breaks and section breaks.',
          'Adding headers, footers, automatic page numbering and page borders.'
        ]
      },
      {
        code: 'B6',
        title: 'Create and format tables in a document',
        month: 1,
        week: '3',
        sessions: 2,
        minutes: 360,
        theory: [
          'Creating tables, entering and editing tabular data.',
          'Inserting/deleting rows and columns, adjusting column width and row height.',
          'Merging and splitting cells inside complex tables.',
          'Modifying cell border styles, shading and text direction.',
          'Sorting table data and applying table formulas (SUM, AVERAGE).'
        ]
      },
      {
        code: 'B7',
        title: 'Insert objects and link into a document',
        month: 1,
        week: '4',
        sessions: 2,
        minutes: 360,
        theory: [
          'Inserting pictures, clip art, charts and linked OLE objects.',
          'Moving, resizing, cropping and duplicating images and charts.',
          'Inserting shapes, WordArt and text boxes.',
          'Grouping, ordering (Bring to Front/Send to Back), aligning objects and text wrapping.'
        ]
      },
      {
        code: 'B8',
        title: 'Carryout mail merging of a document',
        month: 1,
        week: '4',
        sessions: 2,
        minutes: 360,
        theory: [
          'Preparing a recipient mailing list / external data source.',
          'Preparing the main form letter, envelope or label document with merge fields.',
          'Merging data source with main document to generate personalized outputs.'
        ]
      },
      {
        code: 'B9',
        title: 'Review document',
        month: 1,
        week: '4',
        sessions: 1,
        minutes: 180,
        theory: [
          'Enabling and applying Track Changes during document review.',
          'Inserting, editing and replying to review comments.',
          'Accepting and rejecting tracked changes and markups.'
        ]
      },
      {
        code: 'B10',
        title: 'Prepare final document',
        month: 1,
        week: '4',
        sessions: 2,
        minutes: 360,
        theory: [
          'Proofing document layout, presentation and formatting consistency.',
          'Correcting spelling and grammar errors and adding words to custom dictionary.',
          'Generating automatic Table of Contents (TOC) and Table of Figures.',
          'Inspecting document in Print Preview to eliminate layout errors.'
        ]
      },
      {
        code: 'B11',
        title: 'Save and print',
        month: 1,
        week: '4',
        sessions: 1,
        minutes: 180,
        theory: [
          'Saving finalized documents in required export formats (PDF/XPS).',
          'Selecting print options: page ranges, odd/even, copies, collation and scaling.',
          'Printing documents on configured local or network printers.'
        ]
      }
    ]
  },

  {
    code: 'M03',
    headerTitle: 'M-03. Prepare Spread Sheets',
    title: 'Preparing spread sheets',
    theoryHours: 24,
    practicalHours: 36,
    totalHours: 60,
    resources: [
      'Printer          - 01',
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'C1',
        title: 'Perform basic spreadsheet operations',
        month: 2,
        week: '5',
        sessions: 2,
        minutes: 360,
        theory: [
          'Creating new workbooks from default templates and saving to drives.',
          'Inserting, renaming, copying, moving and deleting worksheets.',
          'Selecting multiple worksheets and arranging multi-window views.',
          'Protecting worksheets/workbooks with passwords and using Help.'
        ]
      },
      {
        code: 'C2',
        title: 'Adjust settings',
        month: 2,
        week: '5',
        sessions: 2,
        minutes: 360,
        theory: [
          'Using zoom/magnification tools and customizing ribbons/toolbars.',
          'Freezing and unfreezing row and column titles (Freeze Panes).',
          'Hiding and unhiding rows, columns and worksheets.',
          'Adjusting cell dimensions, alignments and cell styles.'
        ]
      },
      {
        code: 'C3',
        title: 'Select, insert and delete cells, rows and column',
        month: 2,
        week: '5',
        sessions: 1,
        minutes: 180,
        theory: [
          'Selecting single cells, adjacent ranges, non-adjacent ranges and entire sheets.',
          'Selecting adjacent and non-adjacent rows and columns.',
          'Inserting and deleting cells, rows and columns safely.'
        ]
      },
      {
        code: 'C4',
        title: 'Format cells',
        month: 2,
        week: '5',
        sessions: 2,
        minutes: 360,
        theory: [
          'Formatting number types: General, Number, Currency, Accounting, Date, Time, Percentage.',
          'Applying font styles, sizes, colours and cell background fills.',
          'Copying cell formatting using Format Painter.',
          'Applying text wrapping, text orientation angles, cell merging and borders.'
        ]
      },
      {
        code: 'C5',
        title: 'Insert data / tables to spreadsheet',
        month: 2,
        week: '5',
        sessions: 1,
        minutes: 180,
        theory: [
          'Entering and editing numerical, text and date values in cells.',
          'Creating structured Excel Tables and Pivot Tables.',
          'Importing external data from CSV, text and database files.'
        ]
      },
      {
        code: 'C6',
        title: 'Carry out Copying, moving and deleting cell content / cell range',
        month: 2,
        week: '5',
        sessions: 1,
        minutes: 180,
        theory: [
          'Copying and moving cell ranges across worksheets and open workbooks.',
          'Using Paste Special options (Values, Formulas, Transpose).',
          'Generating series using AutoFill and Fill Handle tools.'
        ]
      },
      {
        code: 'C7',
        title: 'Search and replace cell content',
        month: 2,
        week: '6',
        sessions: 1,
        minutes: 180,
        theory: [
          'Locating specific values or formulas across sheets using Find.',
          'Bulk-updating cell contents and formats using Replace.'
        ]
      },
      {
        code: 'C8',
        title: 'Sort and filtering data',
        month: 2,
        week: '6',
        sessions: 1,
        minutes: 180,
        theory: [
          'Sorting data ranges by single and multiple columns (ascending/descending).',
          'Filtering records using AutoFilter and custom criteria.',
          'Highlighting cells dynamically using Conditional Formatting rules.'
        ]
      },
      {
        code: 'C9',
        title: 'Use arithmetic formulae and functions',
        month: 2,
        week: '6',
        sessions: 3,
        minutes: 540,
        theory: [
          'Relative, absolute ($A$1) and mixed cell referencing in formulas.',
          'Writing arithmetic formulas while avoiding #DIV/0!, #VALUE!, #REF! errors.',
          'Using statistical & math functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA.',
          'Building conditional logic with IF functions and named cell ranges.'
        ]
      },
      {
        code: 'C10',
        title: 'Create charts / graphs',
        month: 2,
        week: '6',
        sessions: 2,
        minutes: 360,
        theory: [
          'Creating Column, Bar, Line and Pie charts from worksheet data.',
          'Adding and formatting chart titles, axis labels, data labels and legends.',
          'Customizing chart colours, styles, plot area and chart types.',
          'Moving, resizing and embedding charts across worksheets.'
        ]
      },
      {
        code: 'C11',
        title: 'Setup worksheet',
        month: 2,
        week: '7',
        sessions: 1,
        minutes: 180,
        theory: [
          'Configuring page margins, Portrait/Landscape orientation, paper size and Page Fit scaling.',
          'Inserting manual page breaks and Page Break Preview.',
          'Customizing worksheet headers, footers and page print order.'
        ]
      },
      {
        code: 'C12',
        title: 'Prepare and print spreadsheet',
        month: 2,
        week: '7',
        sessions: 2,
        minutes: 360,
        theory: [
          'Auditing formulas and text before printing.',
          'Toggling gridlines and row/column headings for print.',
          'Setting Print Titles (repeating header rows/columns on every page).',
          'Printing selected cell ranges, active sheets, entire workbooks or charts.'
        ]
      },
      {
        code: 'C13',
        title: 'Save and Export data',
        month: 2,
        week: '7',
        sessions: 1,
        minutes: 180,
        theory: [
          'Saving workbooks in alternative formats (.xlsx, .csv, .pdf, .ods).',
          'Exporting structured spreadsheet data for external systems.'
        ]
      }
    ]
  },

  {
    code: 'M04',
    headerTitle: 'M-04. Prepare Presentations',
    title: 'Preparing presentations',
    theoryHours: 12,
    practicalHours: 18,
    totalHours: 30,
    resources: [
      'Printer          - 01',
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'D1',
        title: 'Perform basic operations with presentations software',
        month: 2,
        week: '7',
        sessions: 1,
        minutes: 180,
        theory: [
          'Opening/closing presentation software and managing multiple decks.',
          'Creating new presentations from default and blank templates.',
          'Saving presentations in different locations and exporting formats.'
        ]
      },
      {
        code: 'D2',
        title: 'Adjust settings',
        month: 2,
        week: '7',
        sessions: 1,
        minutes: 120,
        theory: [
          'Setting slide size (16:9 Widescreen / 4:3) according to output projector.',
          'Using zoom tools, displaying/hiding ribbons and modifying preferences.'
        ]
      },
      {
        code: 'D3',
        title: 'Change views',
        month: 2,
        week: '7',
        sessions: 1,
        minutes: 120,
        theory: [
          'Understanding Normal, Outline, Slide Sorter, Notes Page and Reading views.',
          'Switching view modes efficiently during slide authoring and review.'
        ]
      },
      {
        code: 'D4',
        title: 'Add / Delete / Move slides',
        month: 2,
        week: '7',
        sessions: 1,
        minutes: 120,
        theory: [
          'Inserting new slides with appropriate slide layouts.',
          'Changing slide layouts without losing existing content.',
          'Duplicating, rearranging, hiding and deleting slides.'
        ]
      },
      {
        code: 'D5',
        title: 'Use design templates',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Selecting appropriate built-in or custom design themes.',
          'Modifying theme colour palettes, font pairs and background styles.'
        ]
      },
      {
        code: 'D6',
        title: 'Use slide masters',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Opening Slide Master view and understanding master layout hierarchy.',
          'Configuring global logos, fonts, footers, slide numbers and dates.'
        ]
      },
      {
        code: 'D7',
        title: 'Format text input',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 180,
        theory: [
          'Adding and editing text in placeholders, text boxes and Outline view.',
          'Formatting character attributes, decorative WordArt and paragraph alignment.',
          'Adjusting line spacing, bulleted/numbered lists and presenter speaker notes.'
        ]
      },
      {
        code: 'D8',
        title: 'Insert multimedia objects',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Inserting, resizing and formatting images and graphics.',
          'Inserting audio clips, video clips and data charts into slides.'
        ]
      },
      {
        code: 'D9',
        title: 'Copy, move and delete text and images',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Copying and moving text/visual elements within and between presentations.',
          'Resizing, cropping and deleting unwanted slide objects.'
        ]
      },
      {
        code: 'D10',
        title: 'Insert / Modify SmartArt',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Inserting SmartArt graphics (Process, Hierarchy, Cycle, Relationship).',
          'Adding/demoting shapes, changing layouts and applying SmartArt styles.'
        ]
      },
      {
        code: 'D11',
        title: 'Insert / modify drawing objects into slides',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Drawing shapes, lines, arrows and callouts on slides.',
          'Formatting fills, outlines, effects, grouping and layering order.'
        ]
      },
      {
        code: 'D12',
        title: 'Insert links',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Inserting hyperlinks to external websites, files and slides.',
          'Adding interactive Action Buttons for non-linear slide navigation.'
        ]
      },
      {
        code: 'D13',
        title: 'Apply transition effects, and animation',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Applying Entrance, Emphasis, Exit and Motion Path custom animations.',
          'Setting slide transitions, sound effects and automatic timing.'
        ]
      },
      {
        code: 'D14',
        title: 'Prepare for presentation and/or printing',
        month: 2,
        week: '8',
        sessions: 1,
        minutes: 120,
        theory: [
          'Rehearsing timings, recording narrations and creating Custom Slide Shows.',
          'Delivering presentations using Presenter View and laser/pen tools.',
          'Printing slides, handouts (3/6 per page), notes pages and exporting PDF/video.'
        ]
      }
    ]
  },

  {
    code: 'M05',
    headerTitle: 'M-05. Cloud Computing, Internet & Email Services',
    title: 'Performing basic operations of cloud computing including internet and email services',
    theoryHours: 24,
    practicalHours: 24,
    totalHours: 48,
    resources: [
      'Marker Pens      - 02',
      'A4 Sheets        - 30',
      'Printer          - 01'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Internet.',
      'Computers.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'E1',
        title: 'Access Internet services',
        month: 3,
        week: '9',
        sessions: 5,
        minutes: 900,
        theory: [
          'Selecting and opening modern web browsers and navigation controls.',
          'Managing bookmarks/favorites, saving web pages offline and customizing home pages.',
          'Using traditional search engines and AI-based search engines effectively.',
          'Searching and downloading documents, audio, video, images and software safely.',
          'Clearing temporary internet cache, cookies, browsing history and managing extensions.',
          'Printing full or selected sections of web pages to printer/PDF.'
        ]
      },
      {
        code: 'E2',
        title: 'Use email services',
        month: 3,
        week: '9 & 10',
        sessions: 3,
        minutes: 540,
        theory: [
          'Creating/signing up for professional email accounts and secure sign-in.',
          'Composing, reading, replying and forwarding emails.',
          'Using To, CC and BCC fields appropriately according to workplace etiquette.',
          'Attaching files, downloading attachments safely and organizing folders/labels/signatures.'
        ]
      },
      {
        code: 'E3',
        title: 'Work with social media/sites',
        month: 3,
        week: '10',
        sessions: 2,
        minutes: 360,
        theory: [
          'Accessing social media platforms following cybersecurity and privacy best practices.',
          'Publishing digital content professionally on social networks.',
          'Creating, customizing and managing a YouTube channel and video uploads.'
        ]
      },
      {
        code: 'E4',
        title: 'Use software applications collaboratively',
        month: 3,
        week: '10',
        sessions: 2,
        minutes: 360,
        theory: [
          'Creating and sharing cloud documents, spreadsheets and presentations (Google Workspace / MS 365).',
          'Managing collaborative access permissions (Viewer, Commenter, Editor).',
          'Designing online forms (Google Forms / MS Forms) to collect and analyze survey responses.'
        ]
      },
      {
        code: 'E5',
        title: 'Use software applications for video conference',
        month: 3,
        week: '10',
        sessions: 2,
        minutes: 360,
        theory: [
          'Scheduling virtual meetings (Zoom / Google Meet / MS Teams) with participant invites.',
          'Configuring host privileges, waiting rooms, screen sharing and breakout rooms.',
          'Recording meetings and exporting participant attendance logs per organizational ethics.'
        ]
      },
      {
        code: 'E6',
        title: 'Handle cloud storages',
        month: 3,
        week: '10',
        sessions: 2,
        minutes: 360,
        theory: [
          'Uploading files and directory structures to cloud storage (Google Drive / OneDrive) per SOP.',
          'Performing cloud backup and file version restoration.',
          'Sharing cloud folders and configuring automatic desktop-to-cloud folder synchronization.'
        ]
      }
    ]
  },

  {
    code: 'M06',
    headerTitle: 'M-06. Perform Basic Database Manipulation',
    title: 'Performing basic database manipulation',
    theoryHours: 24,
    practicalHours: 36,
    totalHours: 60,
    resources: [
      'A4 Sheets        - 30',
      'Marker Pens      - 02',
      'Printer          - 01'
    ],
    services: [
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'F1',
        title: 'Perform basic operations',
        month: 3,
        week: '11',
        sessions: 3,
        minutes: 540,
        theory: [
          'Introduction to relational database concepts and desktop DBMS (MS Access / Base).',
          'Opening and closing the database application properly.',
          'Creating a new blank database and saving to a designated drive location.',
          'Opening existing databases and navigating database objects (Tables, Queries, Forms, Reports).'
        ]
      },
      {
        code: 'F2',
        title: 'Create and modify tables',
        month: 3,
        week: '11',
        sessions: 3,
        minutes: 540,
        theory: [
          'Designing tables in Design View with appropriate field names and naming conventions.',
          'Selecting data types (Short Text, Number, Currency, Date/Time, Yes/No, AutoNumber).',
          'Configuring field properties, field sizes, input masks and validation rules/text.',
          'Inserting, modifying and deleting fields within existing tables.'
        ]
      },
      {
        code: 'F3',
        title: 'Define keys and build relationships',
        month: 3,
        week: '11',
        sessions: 2,
        minutes: 360,
        theory: [
          'Defining Primary Keys and Foreign Keys according to database normalization principles.',
          'Indexing fields (with and without duplicates) for fast retrieval.',
          'Building One-to-Many relationships and enforcing Referential Integrity.'
        ]
      },
      {
        code: 'F4',
        title: 'Manipulate table data using datasheet / form',
        month: 3,
        week: '12',
        sessions: 3,
        minutes: 540,
        theory: [
          'Adding, modifying and deleting records in Datasheet View.',
          'Creating user-friendly data entry Forms bound to single and multiple tables.',
          'Importing table structures and data from external Excel/CSV files and exporting data.'
        ]
      },
      {
        code: 'F5',
        title: 'Create and modify Queries',
        month: 3,
        week: '12',
        sessions: 2,
        minutes: 360,
        theory: [
          'Designing Select Queries across single and multiple related tables.',
          'Applying filter criteria, comparison operators, wildcards and logical AND/OR.',
          'Adding calculated fields and aggregate functions (SUM, AVG, COUNT, MIN, MAX).'
        ]
      },
      {
        code: 'F6',
        title: 'Create and modify reports',
        month: 3,
        week: '12',
        sessions: 4,
        minutes: 720,
        theory: [
          'Creating structured Reports based on tables or queries using Report Wizard & Design View.',
          'Arranging data fields, labels and headings neatly within report layouts.',
          'Grouping and sorting report records with group headers/footers.',
          'Adding summary aggregate calculations, page headers/footers and saving reports.'
        ]
      },
      {
        code: 'F7',
        title: 'Print required information',
        month: 3,
        week: '12',
        sessions: 3,
        minutes: 540,
        theory: [
          'Previewing table structures, form layouts and query results before printing.',
          'Configuring page setup, margins and orientation for wide database reports.',
          'Printing finalized reports and exporting to PDF.'
        ]
      }
    ]
  },

  {
    code: 'M07',
    headerTitle: 'M-07. Computer System, Network and Peripherals',
    title: 'Computer system, network and peripherals',
    theoryHours: 36,
    practicalHours: 24,
    totalHours: 60,
    resources: [
      'RJ-45 Jacks      - 20',
      'Network Cable    - 15m',
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Electricity',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers & Peripherals.',
      'Network Switch / Router.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'G1',
        title: 'Identify and Setup computer & network devices',
        month: 4,
        week: '13',
        sessions: 3,
        minutes: 540,
        theory: [
          'Identifying computer internal components, I/O peripherals and power protection (UPS/Surge).',
          'Identifying network devices (Switches, Routers, Access Points, NICs, UTP Cat6 cables).',
          'Crimping RJ-45 LAN cables (T568A / T568B) and testing continuity.',
          'Connecting, installing and configuring peripherals (Printers, Scanners) and LAN settings per manufacturer guidelines.'
        ]
      },
      {
        code: 'G2',
        title: 'Rectify faults',
        month: 4,
        week: '13 & 14',
        sessions: 8,
        minutes: 1440,
        theory: [
          'Preparing bootable media, partitioning disks and clean-installing Operating Systems (Windows / Linux).',
          'Installing, configuring and uninstalling standard office and utility application software.',
          'Applying OS security patches and feature updates.',
          'Inspecting Device Manager to install and update missing or outdated hardware drivers.',
          'Diagnosing and rectifying common hardware (RAM, HDD/SSD, PSU) and network connectivity (IP/DNS) faults or escalating per SOP.'
        ]
      },
      {
        code: 'G3',
        title: 'Maintain computer system',
        month: 4,
        week: '14 & 15',
        sessions: 9,
        minutes: 1620,
        theory: [
          'Installing, configuring and updating endpoint Antivirus & Firewall security software.',
          'Performing full system malware scans, virus removal and quarantine management.',
          'Executing preventive disk maintenance: Disk Cleanup, TRIM and Defragmentation.',
          'Performing system image backups, restore points and user data recovery per SOP.',
          'Reporting critical hardware/network incidents to authorized officers and maintaining official Maintenance Logs.'
        ]
      }
    ]
  },

  {
    code: 'M08',
    headerTitle: 'M-08. Produce Print Page Layout and Multimedia Objects',
    title: 'Producing Print Page Layout and multimedia objects',
    theoryHours: 30,
    practicalHours: 48,
    totalHours: 78,
    resources: [
      'Printer          - 01',
      'Scanner          - 01',
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers (Graphics Suite).',
      'Scanner / Printer.',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'H1',
        title: 'Develop a basic design concept for Page layout',
        month: 4,
        week: '15',
        sessions: 5,
        minutes: 900,
        theory: [
          'Identifying client brief and target design requirements (purpose, audience, budget, deadline).',
          'Principles of graphic design: balance, contrast, hierarchy, alignment and typography.',
          'Understanding colour modes (CMYK for print vs. RGB for screen) and print bleed/margins.',
          'Producing tentative thumbnail sketches, wireframes and obtaining client concept approval.'
        ]
      },
      {
        code: 'H2',
        title: 'Gather graphics & Illustration for Page layout',
        month: 4,
        week: '16',
        sessions: 5,
        minutes: 900,
        theory: [
          'Sourcing and verifying resolution/quality of photographs, logos and vector illustrations.',
          'Selecting and operating optical scanners at appropriate DPI resolution (300 DPI print / 72 DPI web).',
          'Organizing project assets in structured directories using standard formats (PSD, AI, TIFF, PNG, JPEG, SVG).'
        ]
      },
      {
        code: 'H3',
        title: 'Design Page Layout',
        month: 4,
        week: '16 & 17',
        sessions: 8,
        minutes: 1440,
        theory: [
          'Setting up document medium dimensions, columns, guides, bleed and slug areas.',
          'Building reusable master layout templates according to approved design concepts.',
          'Applying professional typographic formatting, kerning, leading and paragraph styles.',
          'Combining vector illustrations and retouched raster images on structured layers.',
          'Proofreading artwork, preflighting colours/fonts and exporting print-ready PDF proofs for client sign-off.'
        ]
      },
      {
        code: 'H4',
        title: 'Design multimedia products for social media / web sites',
        month: 5,
        week: '17 & 18',
        sessions: 8,
        minutes: 1440,
        theory: [
          'Identifying client requirements and aspect ratios for web banners, social media posts and reels.',
          'Selecting desktop, web and mobile multimedia authoring tools (Photoshop, Illustrator, Canva, CapCut/Premiere).',
          'Editing graphics, animations, audio/video clips and optimizing file sizes for fast web loading.',
          'Archiving editable source files per organizational guidelines and delivering finalized digital assets.'
        ]
      }
    ]
  },

  {
    code: 'M09',
    headerTitle: 'M-09. Systems Analysis and Designing',
    title: 'Systems Analysis and Designing',
    theoryHours: 36,
    practicalHours: 12,
    totalHours: 48,
    resources: [
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers',
      '- Theory Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers (CASE / Diagram Tools).',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'I1',
        title: 'Gather requirements for information system',
        month: 5,
        week: '18',
        sessions: 6,
        minutes: 1080,
        theory: [
          'Software Development Life Cycle (SDLC) models and requirement engineering.',
          'Fact-finding techniques: stakeholder interviews, questionnaires, observation and document review.',
          'Conducting Technical, Economic and Operational Feasibility Studies per SOP.',
          'Documenting functional and non-functional requirements in a standard Software Requirement Specification (SRS) and obtaining sign-off.'
        ]
      },
      {
        code: 'I2',
        title: 'Design information system',
        month: 5,
        week: '19',
        sessions: 10,
        minutes: 1800,
        theory: [
          'Developing Context Diagrams (Level 0) and Data Flow Diagrams (DFD Level 1 & Level 2).',
          'Reviewing and validating DFDs for consistency and data conservation.',
          'Designing program logic using structured Flowcharts and Pseudocode.',
          'Creating Unified Modeling Language (UML) diagrams: Use Case, Class, Activity and ER Diagrams.',
          'Preparing comprehensive Software Test Plans and Test Cases mapped to system requirements.'
        ]
      }
    ]
  },

  {
    code: 'M10',
    headerTitle: 'M-10. Perform Relational Databases Using Standard SQL',
    title: 'Perform relational databases using standard SQL',
    theoryHours: 24,
    practicalHours: 36,
    totalHours: 60,
    resources: [
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers (MySQL / RDBMS).',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'J1',
        title: 'Startup Database Management System (DBMS)',
        month: 5,
        week: '19',
        sessions: 2,
        minutes: 360,
        theory: [
          'Installing and configuring a relational Database Management System (MySQL Server / Workbench).',
          'Starting/stopping database services and authenticating user accounts per SOP.'
        ]
      },
      {
        code: 'J2',
        title: 'Manipulate Database & Tables',
        month: 5,
        week: '20',
        sessions: 8,
        minutes: 1440,
        theory: [
          'Data Definition Language (DDL): CREATE DATABASE, USE and DROP DATABASE.',
          'Creating tables with appropriate SQL data types (INT, VARCHAR, DECIMAL, DATE, TIMESTAMP) and constraints (NOT NULL, UNIQUE, DEFAULT).',
          'Modifying table schemas using ALTER TABLE (ADD, MODIFY, DROP COLUMN, RENAME).',
          'Defining and modifying Primary Keys and Foreign Keys with referential actions.',
          'Exporting/importing table schemas, performing SQL database backups (mysqldump) and restoring databases.'
        ]
      },
      {
        code: 'J3',
        title: 'Handle data',
        month: 5,
        week: '20',
        sessions: 4,
        minutes: 720,
        theory: [
          'Data Manipulation Language (DML): inserting single and multiple rows using INSERT INTO.',
          'Updating existing records safely using UPDATE ... SET with WHERE clauses.',
          'Deleting records using DELETE FROM with WHERE conditions and TRUNCATE.',
          'Importing and exporting bulk table data (CSV / SQL scripts).'
        ]
      },
      {
        code: 'J4',
        title: 'Create Queries',
        month: 6,
        week: '21',
        sessions: 3,
        minutes: 540,
        theory: [
          'Data Query Language (DQL): SELECT, DISTINCT, WHERE, ORDER BY and LIMIT.',
          'Filtering with comparison operators, BETWEEN, IN, LIKE wildcards and logical operators.',
          'Querying multiple tables using INNER JOIN, LEFT JOIN and RIGHT JOIN.',
          'Using SQL aggregate functions (COUNT, SUM, AVG, MIN, MAX) with GROUP BY and HAVING.'
        ]
      },
      {
        code: 'J5',
        title: 'Manipulate views',
        month: 6,
        week: '21',
        sessions: 3,
        minutes: 540,
        theory: [
          'Understanding virtual tables (Views) for security and query simplification.',
          'Creating views using CREATE VIEW ... AS SELECT.',
          'Updating views using CREATE OR REPLACE VIEW / ALTER VIEW and dropping views (DROP VIEW).'
        ]
      }
    ]
  },

  {
    code: 'M11',
    headerTitle: 'M-11. Design Static Website',
    title: 'Designing static Website',
    theoryHours: 12,
    practicalHours: 18,
    totalHours: 30,
    resources: [
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers (VS Code & Browsers).',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'K1',
        title: 'Identify customer requirement',
        month: 6,
        week: '21',
        sessions: 3,
        minutes: 540,
        theory: [
          'Analyzing client requirements, target audience and site navigation structure.',
          'Designing website wireframes and page layouts (Header, Navbar, Hero, Content, Footer).',
          'Applying web design best practices: usability, accessibility, colour harmony and responsive grid principles.'
        ]
      },
      {
        code: 'K2',
        title: 'Create a web page using HTML',
        month: 6,
        week: '22',
        sessions: 4,
        minutes: 720,
        theory: [
          'HTML5 document skeleton (<!DOCTYPE html>, <html>, <head>, <meta>, <title>, <body>).',
          'Structuring content with semantic elements (<header>, <nav>, <main>, <section>, <article>, <footer>).',
          'Formatting headings, paragraphs, ordered/unordered lists and data tables.',
          'Embedding images, audio, video, iframes and HTML forms (<input>, <select>, <textarea>, <button>).',
          'Linking internal pages, page anchors and external URLs using relative and absolute hyperlinks.'
        ]
      },
      {
        code: 'K3',
        title: 'Enhance the view of the web pages using CSS',
        month: 6,
        week: '22',
        sessions: 3,
        minutes: 540,
        theory: [
          'CSS syntax (selectors, properties, values) and specificity (element, .class, #id).',
          'Applying Inline, Internal (<style>) and External (.css stylesheet) styling methods.',
          'Mastering the CSS Box Model (margin, border, padding, width/height), typography and colours.',
          'Building modern page layouts using Flexbox, CSS Grid and responsive @media queries.'
        ]
      }
    ]
  },

  {
    code: 'M12',
    headerTitle: 'M-12. Develop Desktop Applications',
    title: 'Developing Desktop applications',
    theoryHours: 48,
    practicalHours: 36,
    totalHours: 84,
    resources: [
      'Marker Pens      - 02',
      'A4 Sheets        - 30'
    ],
    services: [
      '- Internet',
      '- Notes & Presentation'
    ],
    assessment: [
      '- Performance Guide',
      '- Practical Papers',
      '- Theory Papers'
    ],
    media: [
      'White Board.',
      'MM Projector.',
      'Computers (IDE & DBMS).',
      'PG & Skill Standard.'
    ],
    tasks: [
      {
        code: 'L1.1',
        title: 'Develop software using selected programming language according to specification',
        month: 6,
        week: '22 & 23',
        sessions: 8,
        minutes: 1440,
        theory: [
          'Setting up the Integrated Development Environment (IDE) and project architecture.',
          'Programming fundamentals: variables, data types, operators, control structures (if/switch, loops).',
          'Modular programming with functions/methods, Object-Oriented Programming (OOP) classes and objects.',
          'Designing Graphical User Interfaces (GUI forms, input controls, menus, validation & event handling).'
        ]
      },
      {
        code: 'L1.2',
        title: 'Connect database to application for data storage and manipulation',
        month: 6,
        week: '23',
        sessions: 8,
        minutes: 1440,
        theory: [
          'Configuring database drivers/connectors (ODBC / JDBC / ADO.NET / MySQL Connector) and connection strings.',
          'Implementing parameterized CRUD operations (Create, Read, Update, Delete) from GUI forms.',
          'Binding database query results to data grids, combo boxes and summary reports.',
          'Handling database exceptions, transactions and secure user authentication.'
        ]
      },
      {
        code: 'L1.3',
        title: 'Test developed software as per test plan and test cases',
        month: 6,
        week: '24',
        sessions: 4,
        minutes: 720,
        theory: [
          'Executing Unit Testing, Integration Testing and System Testing against the Test Plan.',
          'Validating boundary conditions, input validation and error handling routines.',
          'Logging defects, debugging code and conducting User Acceptance Testing (UAT).'
        ]
      },
      {
        code: 'L1.4',
        title: 'Prepare system specification documentation and user guide as per SOP',
        month: 6,
        week: '24',
        sessions: 4,
        minutes: 720,
        theory: [
          'Compiling final Technical System Documentation (architecture, ER schema, source code overview).',
          'Writing a step-by-step illustrated User Guide & Installation Manual per organizational SOP.'
        ]
      },
      {
        code: 'L1.5',
        title: 'Package and deploy software as per standard procedure',
        month: 6,
        week: '24',
        sessions: 4,
        minutes: 720,
        theory: [
          'Building release binaries and bundling required runtime dependencies and database scripts.',
          'Creating an executable Setup/Installer package and deploying on target client machines.'
        ]
      }
    ]
  }
];

function xmlEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Pure Node.js ZIP Archive Builder (no external dependencies)
 * Produces a standard PKZIP (.xlsx) buffer from an array of { name, data } entries.
 */
function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = zlib.crc32(rawBuf) >>> 0;
    const compressed = zlib.deflateRawSync(rawBuf, { level: 9 });

    // Local file header (30 bytes + name)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);         // version needed (2.0)
    lh.writeUInt16LE(0, 6);          // flags
    lh.writeUInt16LE(8, 8);          // compression method: deflate (8)
    lh.writeUInt16LE(0, 10);         // mod time
    lh.writeUInt16LE(0x4821, 12);    // mod date
    lh.writeUInt32LE(crc, 14);       // crc32
    lh.writeUInt32LE(compressed.length, 18); // compressed size
    lh.writeUInt32LE(rawBuf.length, 22);     // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);    // filename length
    lh.writeUInt16LE(0, 28);                 // extra length

    localParts.push(lh, nameBuf, compressed);

    // Central directory header (46 bytes + name)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // signature
    ch.writeUInt16LE(20, 4);         // version made by
    ch.writeUInt16LE(20, 6);         // version needed
    ch.writeUInt16LE(0, 8);          // flags
    ch.writeUInt16LE(8, 10);         // compression: deflate
    ch.writeUInt16LE(0, 12);         // mod time
    ch.writeUInt16LE(0x4821, 14);    // mod date
    ch.writeUInt32LE(crc, 16);       // crc32
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(rawBuf.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);         // extra length
    ch.writeUInt16LE(0, 32);         // comment length
    ch.writeUInt16LE(0, 34);         // disk number
    ch.writeUInt16LE(0, 36);         // internal attrs
    ch.writeUInt32LE(0, 38);         // external attrs
    ch.writeUInt32LE(offset, 42);    // relative offset of local header

    centralParts.push(ch, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);          // disk num
  eocd.writeUInt16LE(0, 6);          // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/**
 * Generate a native Excel (.xlsx) buffer for a single module (Sheet 1: T1, Sheet 2: T2 <Code>)
 * matching the exact layout, cell merges, borders, and styles of the TVEC accreditation format.
 * Default timeUnit is 'hours' (e.g., "03 Hrs", "0.5 Hrs"); pass timeUnit='minutes' for minutes.
 */
function generateModuleXlsxBuffer(mod, meta = {}, timeUnit = 'hours') {
  const useHours = String(timeUnit).toLowerCase() !== 'minutes';
  const institution = meta.institution || 'VTC - Akuressa (NYSC)';
  const trade = meta.trade || 'ICT Technician';
  const instructor = meta.instructor || 'K.A.R.Lakshan';
  const traineesCount = Number(meta.traineesCount) || 25;

  const sharedStrings = [];
  const ssIndexMap = new Map();
  function addStr(str) {
    const s = String(str == null ? '' : str);
    if (ssIndexMap.has(s)) return ssIndexMap.get(s);
    const idx = sharedStrings.length;
    sharedStrings.push(s);
    ssIndexMap.set(s, idx);
    return idx;
  }

  const cStr = (ref, style, text) => `<c r="${ref}" s="${style}" t="s"><v>${addStr(text)}</v></c>`;
  const cNum = (ref, style, num) => `<c r="${ref}" s="${style}"><v>${Number(num)}</v></c>`;
  const cEmpty = (ref, style) => `<c r="${ref}" s="${style}"/>`;

  // =========================================================================
  // SHEET 1: T-1 (Scheme of Training)
  // =========================================================================
  const tasks = mod.tasks || [];
  const startRow = 13;
  const endRow = startRow + tasks.length - 1;
  const t1Rows = [];
  const t1Merges = [
    'A1:H1', 'A4:B4', 'D4:F4', 'A5:B5', 'D5:F5', 'G5:H5',
    'A8:E8', 'G8:H8', 'A9:E9', 'D12:H12',
    `I${startRow}:I${endRow}`,
    `J${startRow}:J${endRow}`,
    `K${startRow}:K${endRow}`
  ];

  // Row 1: Title & Format T - 1
  t1Rows.push(
    `<row r="1" spans="1:11" ht="17.25" customHeight="1">` +
      cStr('A1', 40, 'Scheme of Training') +
      ['B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'].map(r => cEmpty(r, 40)).join('') +
      cStr('I1', 6, 'Format') +
      cStr('K1', 6, 'T - 1') +
    `</row>`
  );

  // Row 4: Values for Institution, Trade, Instructor, No.of Trainees
  t1Rows.push(
    `<row r="4" spans="1:11">` +
      cStr('A4', 30, institution) + cEmpty('B4', 31) +
      cStr('D4', 30, trade) + cEmpty('E4', 38) + cEmpty('F4', 31) +
      cEmpty('G4', 3) + cEmpty('H4', 3) +
      cStr('I4', 2, instructor) + cEmpty('J4', 3) +
      cNum('K4', 2, traineesCount) +
    `</row>`
  );

  // Row 5: Labels for Institution, Trade, Instructor, No.of Trainees
  t1Rows.push(
    `<row r="5" spans="1:11">` +
      cStr('A5', 32, 'Institution') + cEmpty('B5', 32) + cEmpty('C5', 7) +
      cStr('D5', 39, 'Trade') + cEmpty('E5', 39) + cEmpty('F5', 39) +
      cEmpty('G5', 29) + cEmpty('H5', 29) +
      cStr('I5', 8, 'Instructor') + cEmpty('J5', 9) +
      cStr('K5', 10, 'No.of Trainees') +
    `</row>`
  );

  t1Rows.push(`<row r="6" spans="1:11">${cEmpty('J6', 5)}${cEmpty('K6', 1)}</row>`);
  t1Rows.push(`<row r="7" spans="1:11">${cEmpty('J7', 5)}${cEmpty('K7', 1)}</row>`);

  // Row 8: Module Title & Blank Date boxes (reusable - no fixed dates)
  t1Rows.push(
    `<row r="8" spans="1:11">` +
      cStr('A8', 30, `${mod.headerTitle || `${mod.code} - ${mod.title}`} (${mod.totalHours} Hrs)`) +
      cEmpty('B8', 38) + cEmpty('C8', 38) + cEmpty('D8', 38) + cEmpty('E8', 31) +
      cEmpty('G8', 51) + cEmpty('H8', 51) +
      cEmpty('I8', 25) + cEmpty('J8', 3) + cEmpty('K8', 2) +
    `</row>`
  );

  // Row 9: Module / Date of Prepared / Date of Revised labels
  t1Rows.push(
    `<row r="9" spans="1:11">` +
      cStr('A9', 29, 'Module') + cEmpty('B9', 29) + cEmpty('C9', 29) + cEmpty('D9', 29) + cEmpty('E9', 29) +
      cEmpty('F9', 10) + cEmpty('G9', 10) + cEmpty('H9', 10) +
      cStr('I9', 10, 'Date of Prepared') + cEmpty('J9', 11) +
      cStr('K9', 11, 'Date of Revised') +
    `</row>`
  );

  // Row 12: Table Header
  t1Rows.push(
    `<row r="12" spans="1:11" ht="39" customHeight="1">` +
      cStr('A12', 12, 'Month') +
      cStr('B12', 12, 'Week No') +
      cStr('C12', 12, useHours ? 'Hours' : 'Session') +
      cStr('D12', 44, 'Module & Coverd\nexpected cover') +
      cEmpty('E12', 44) + cEmpty('F12', 44) + cEmpty('G12', 44) + cEmpty('H12', 44) +
      cStr('I12', 12, 'Resource & Cost') +
      cStr('J12', 12, 'Service & Utility') +
      cStr('K12', 12, 'Assesment Guidance') +
    `</row>`
  );

  // Group contiguous rows with same Month and same Week No for clean vertical merges
  let mStart = 0;
  while (mStart < tasks.length) {
    let mEnd = mStart;
    while (mEnd + 1 < tasks.length && tasks[mEnd + 1].month === tasks[mStart].month) mEnd++;
    if (mEnd > mStart) {
      t1Merges.push(`A${startRow + mStart}:A${startRow + mEnd}`);
    }
    mStart = mEnd + 1;
  }

  let wStart = 0;
  while (wStart < tasks.length) {
    let wEnd = wStart;
    while (wEnd + 1 < tasks.length && String(tasks[wEnd + 1].week) === String(tasks[wStart].week)) wEnd++;
    if (wEnd > wStart) {
      t1Merges.push(`B${startRow + wStart}:B${startRow + wEnd}`);
    }
    wStart = wEnd + 1;
  }

  const resText = '\n' + (mod.resources || []).join('\n') + '\n';
  const srvText = ' ' + (mod.services || []).join('\n ');
  const assText = ' ' + (mod.assessment || []).join('\n ');

  tasks.forEach((t, idx) => {
    const r = startRow + idx;
    const isFirst = idx === 0;
    const isLast = idx === tasks.length - 1;
    t1Merges.push(`E${r}:H${r}`);

    const isMonthGroupStart = idx === 0 || tasks[idx - 1].month !== t.month;
    const isWeekGroupStart = idx === 0 || String(tasks[idx - 1].week) !== String(t.week);

    const aStyle = isFirst ? 41 : isLast ? 43 : 42;
    const ijkStyle = isFirst ? 35 : isLast ? 37 : 36;

    const aCell = isMonthGroupStart ? cNum(`A${r}`, aStyle, t.month) : cEmpty(`A${r}`, aStyle);
    const bVal = String(t.week);
    const bCell = isWeekGroupStart
      ? (/^\d+$/.test(bVal) ? cNum(`B${r}`, 34, Number(bVal)) : cStr(`B${r}`, 34, bVal))
      : cEmpty(`B${r}`, 34);

    const taskHours = Math.round(((t.minutes || t.sessions * 180) / 60) * 10) / 10;
    const cCell = useHours
      ? cStr(`C${r}`, 21, fmtHrs(taskHours))
      : cNum(`C${r}`, 21, t.sessions);
    const dCell = cStr(`D${r}`, 21, t.code);
    const eCells = cStr(`E${r}`, 33, t.title) + cEmpty(`F${r}`, 33) + cEmpty(`G${r}`, 33) + cEmpty(`H${r}`, 33);

    const iCell = isFirst ? cStr(`I${r}`, ijkStyle, resText) : cEmpty(`I${r}`, ijkStyle);
    const jCell = isFirst ? cStr(`J${r}`, ijkStyle, srvText) : cEmpty(`J${r}`, ijkStyle);
    const kCell = isFirst ? cStr(`K${r}`, ijkStyle, assText) : cEmpty(`K${r}`, ijkStyle);

    t1Rows.push(
      `<row r="${r}" spans="1:11" ht="24.95" customHeight="1">` +
        aCell + bCell + cCell + dCell + eCells + iCell + jCell + kCell +
      `</row>`
    );
  });

  const sheet1Xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:K${endRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>` +
      `<col min="1" max="1" width="12.85546875" customWidth="1"/>` +
      `<col min="2" max="2" width="15.7109375" customWidth="1"/>` +
      `<col min="3" max="3" width="11.5" customWidth="1"/>` +
      `<col min="8" max="8" width="9" customWidth="1"/>` +
      `<col min="9" max="9" width="22.5" customWidth="1"/>` +
      `<col min="10" max="10" width="19.5" customWidth="1"/>` +
      `<col min="11" max="11" width="22.5" customWidth="1"/>` +
    `</cols>` +
    `<sheetData>${t1Rows.join('')}</sheetData>` +
    `<mergeCells count="${t1Merges.length}">${t1Merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` +
    `<printOptions horizontalCentered="1"/>` +
    `<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="landscape"/>` +
    `</worksheet>`;

  // =========================================================================
  // SHEET 2: T-2 (B . Presentation — Per-Task 7-Step Lesson Breakdown)
  // =========================================================================
  const t2Rows = [];
  const t2Merges = [];
  let curRow = 1;
  const mediaText = (mod.media || ['White Board.', 'MM Projector.', 'Computers.', 'PG & Skill Standard.']).join('\n') + '\n\n';

  for (const t of tasks) {
    const mins = t.minutes || (t.sessions * 180);
    const minSplit = splitT2Minutes(mins);
    const hrSplit = splitT2Hours(mins);
    const fmtStepTime = (key) => useHours
      ? fmtHrs(hrSplit[key])
      : `${String(minSplit[key]).padStart(2, '0')} mns`;
    const totalBannerTime = useHours ? fmtHrs(hrSplit.total) : `${minSplit.total} mns`;

    const theoryList = (t.theory && t.theory.length) ? t.theory : [`Core concepts and operations of ${t.title}.`];

    const rPres = curRow;
    const rTitle = curRow + 1;
    const rNote = curRow + 3;
    const rHdr = curRow + 5;
    const rIntro = curRow + 6; // 4 rows: rIntro .. rIntro + 3
    const rTheory = rIntro + 4; // 1 + theoryList.length rows: rTheory .. rTheory + theoryList.length
    const rTheoryEnd = rTheory + theoryList.length;
    const r3 = rTheoryEnd + 1; // Demonstration
    const r4 = r3 + 1;         // Train under guidance
    const r5 = r3 + 2;         // Train under Individual
    const r6 = r3 + 3;         // Performance checking
    const r7 = r3 + 4;         // Feedback
    const rTot = r7 + 1;       // Total time row

    // Block header rows
    t2Rows.push(
      `<row r="${rPres}" spans="1:7" ht="15.75">` +
        cStr(`A${rPres}`, 60, 'B . Presentation') + cEmpty(`B${rPres}`, 60) + cEmpty(`C${rPres}`, 60) +
      `</row>`
    );
    t2Merges.push(`A${rPres}:C${rPres}`);

    t2Rows.push(
      `<row r="${rTitle}" spans="1:7">` +
        cStr(`A${rTitle}`, 29, `${t.code} - ${t.title} (${totalBannerTime})`) +
        ['B', 'C', 'D', 'E', 'F', 'G'].map(col => cEmpty(`${col}${rTitle}`, 29)).join('') +
      `</row>`
    );
    t2Merges.push(`A${rTitle}:G${rTitle}`);

    t2Rows.push(
      `<row r="${rNote}" spans="1:7">` +
        cStr(`A${rNote}`, 67, 'Activities related to evaluations should also be included here') +
        cEmpty(`B${rNote}`, 67) + cEmpty(`C${rNote}`, 67) +
      `</row>`
    );
    t2Merges.push(`A${rNote}:C${rNote}`);

    // Table header row
    t2Rows.push(
      `<row r="${rHdr}" spans="1:7" ht="30">` +
        cStr(`A${rHdr}`, 12, 'Serial No') +
        cStr(`B${rHdr}`, 52, 'Teaching process\nTeacher(Trainer) activities') + cEmpty(`C${rHdr}`, 53) +
        cStr(`D${rHdr}`, 13, 'Lerning process\nStudent(Trainee) activities') +
        cStr(`E${rHdr}`, 12, 'Methodology') +
        cStr(`F${rHdr}`, 12, 'Reqired Media') +
        cStr(`G${rHdr}`, 12, useHours ? 'Time (Hrs)' : 'Time') +
      `</row>`
    );
    t2Merges.push(`B${rHdr}:C${rHdr}`);

    // Merge Required Media (F) across rIntro .. r7
    t2Merges.push(`F${rIntro}:F${r7}`);

    // Step 1: Introduction (4 rows)
    t2Merges.push(
      `A${rIntro}:A${rIntro + 3}`,
      `B${rIntro}:C${rIntro}`,
      `D${rIntro}:D${rIntro + 3}`,
      `E${rIntro}:E${rIntro + 3}`,
      `G${rIntro}:G${rIntro + 3}`
    );
    t2Rows.push(
      `<row r="${rIntro}" spans="1:7" ht="20.1" customHeight="1">` +
        cNum(`A${rIntro}`, 41, 1) +
        cStr(`B${rIntro}`, 54, 'Introduction') + cEmpty(`C${rIntro}`, 55) +
        cStr(`D${rIntro}`, 56, 'Actively Participating') +
        cStr(`E${rIntro}`, 56, 'Discussion') +
        cStr(`F${rIntro}`, 35, mediaText) +
        cStr(`G${rIntro}`, 41, fmtStepTime('intro')) +
      `</row>`
    );
    const introSub = ['Entrance', 'Explain the title', 'Explain the target of title'];
    introSub.forEach((subTxt, idx) => {
      const rr = rIntro + 1 + idx;
      const isEnd = idx === 2;
      t2Rows.push(
        `<row r="${rr}" spans="1:7" ht="20.1" customHeight="1">` +
          cEmpty(`A${rr}`, isEnd ? 43 : 42) +
          cNum(`B${rr}`, 16, idx + 1) +
          cStr(`C${rr}`, 15, subTxt) +
          cEmpty(`D${rr}`, isEnd ? 37 : 36) +
          cEmpty(`E${rr}`, isEnd ? 37 : 36) +
          cEmpty(`F${rr}`, 36) +
          cEmpty(`G${rr}`, isEnd ? 43 : 42) +
        `</row>`
      );
    });

    // Step 2: Theory (1 + theoryList.length rows)
    t2Merges.push(
      `A${rTheory}:A${rTheoryEnd}`,
      `B${rTheory}:C${rTheory}`,
      `D${rTheory}:D${rTheoryEnd}`,
      `E${rTheory}:E${rTheoryEnd}`,
      `G${rTheory}:G${rTheoryEnd}`
    );
    t2Rows.push(
      `<row r="${rTheory}" spans="1:7" ht="20.1" customHeight="1">` +
        cNum(`A${rTheory}`, 41, 2) +
        cStr(`B${rTheory}`, 45, 'Theory ') + cEmpty(`C${rTheory}`, 47) +
        cStr(`D${rTheory}`, 56, 'Notedown theory knowlage') +
        cStr(`E${rTheory}`, 56, 'Lecture') +
        cEmpty(`F${rTheory}`, 36) +
        cStr(`G${rTheory}`, 41, fmtStepTime('theory')) +
      `</row>`
    );
    theoryList.forEach((thTxt, idx) => {
      const rr = rTheory + 1 + idx;
      const isEnd = idx === theoryList.length - 1;
      t2Rows.push(
        `<row r="${rr}" spans="1:7" ht="20.1" customHeight="1">` +
          cEmpty(`A${rr}`, isEnd ? 43 : 42) +
          cNum(`B${rr}`, 18, idx + 1) +
          cStr(`C${rr}`, 15, thTxt) +
          cEmpty(`D${rr}`, isEnd ? 37 : 36) +
          cEmpty(`E${rr}`, isEnd ? 37 : 36) +
          cEmpty(`F${rr}`, 36) +
          cEmpty(`G${rr}`, isEnd ? 43 : 42) +
        `</row>`
      );
    });

    // Steps 3 to 7
    const stepRowsSpec = [
      { r: r3, no: 3, title: 'Demonstration', learn: 'Looking', method: 'Group', key: 'demo', aStyle: 16, dStyle: 15, fStyle: 36 },
      { r: r4, no: 4, title: 'Train under guidance', learn: 'Training under guidance', method: 'Group', key: 'guided', aStyle: 21, dStyle: 26, fStyle: 36 },
      { r: r5, no: 5, title: 'Train under Induvidual', learn: 'Self Training ', method: 'Induvidual', key: 'individual', aStyle: 21, dStyle: 26, fStyle: 36 },
      { r: r6, no: 6, title: 'Performance checking', learn: 'face to performance test', method: 'Evaluation', key: 'evaluation', aStyle: 16, dStyle: 15, fStyle: 36 },
      { r: r7, no: 7, title: 'Feedback', learn: 'Actively Participating', method: 'Discussion', key: 'feedback', aStyle: 16, dStyle: 15, fStyle: 37 }
    ];
    for (const sr of stepRowsSpec) {
      t2Merges.push(`B${sr.r}:C${sr.r}`);
      t2Rows.push(
        `<row r="${sr.r}" spans="1:7" ht="20.1" customHeight="1">` +
          cNum(`A${sr.r}`, sr.aStyle, sr.no) +
          cStr(`B${sr.r}`, 45, sr.title) + cEmpty(`C${sr.r}`, 47) +
          cStr(`D${sr.r}`, sr.dStyle, sr.learn) +
          cStr(`E${sr.r}`, sr.dStyle, sr.method) +
          cEmpty(`F${sr.r}`, sr.fStyle) +
          cStr(`G${sr.r}`, 21, fmtStepTime(sr.key)) +
        `</row>`
      );
    }

    // Total time row
    t2Rows.push(
      `<row r="${rTot}" spans="1:7">` +
        `<c r="G${rTot}" t="s"><v>${addStr(totalBannerTime)}</v></c>` +
      `</row>`
    );

    curRow = rTot + 6; // Leave 5 blank rows before next task block
  }

  const lastT2Row = Math.max(21, curRow - 6);
  const sheet2Xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:G${lastT2Row}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>` +
      `<col min="2" max="2" width="7.7109375" customWidth="1"/>` +
      `<col min="3" max="3" width="42.0" customWidth="1"/>` +
      `<col min="4" max="4" width="28.28515625" customWidth="1"/>` +
      `<col min="5" max="5" width="18.42578125" customWidth="1"/>` +
      `<col min="6" max="6" width="18.5" customWidth="1"/>` +
      `<col min="7" max="7" width="11.5" customWidth="1"/>` +
    `</cols>` +
    `<sheetData>${t2Rows.join('')}</sheetData>` +
    `<mergeCells count="${t2Merges.length}">${t2Merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` +
    `<printOptions horizontalCentered="1"/>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="landscape"/>` +
    `</worksheet>`;

  const sharedStringsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map(s => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('') +
    `</sst>`;

  const sheet2TabName = `T2 ${mod.code.replace(/^M0?/, 'M')}`;
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<fileVersion appName="xl" lastEdited="5" lowestEdited="5" rupBuild="9302"/>` +
    `<workbookPr defaultThemeVersion="124226"/>` +
    `<bookViews><workbookView xWindow="480" yWindow="135" windowWidth="15600" windowHeight="11760" activeTab="0"/></bookViews>` +
    `<sheets>` +
      `<sheet name="T1" sheetId="1" r:id="rId1"/>` +
      `<sheet name="${xmlEsc(sheet2TabName)}" sheetId="2" r:id="rId2"/>` +
    `</sheets>` +
    `<calcPr calcId="124519"/>` +
    `</workbook>`;

  const entries = [
    { name: '[Content_Types].xml', data: XLSX_TEMPLATE['[Content_Types].xml'] },
    { name: '_rels/.rels', data: XLSX_TEMPLATE['_rels/.rels'] },
    { name: 'xl/_rels/workbook.xml.rels', data: XLSX_TEMPLATE['xl/_rels/workbook.xml.rels'] },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/styles.xml', data: XLSX_TEMPLATE['xl/styles.xml'] },
    { name: 'xl/theme/theme1.xml', data: XLSX_TEMPLATE['xl/theme/theme1.xml'] },
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2Xml },
    { name: 'docProps/core.xml', data: XLSX_TEMPLATE['docProps/core.xml'] },
    { name: 'docProps/app.xml', data: XLSX_TEMPLATE['docProps/app.xml'] }
  ];

  return buildZipBuffer(entries);
}

/**
 * Fetch metadata (Institution, Trade, Instructor, No. of Trainees) from DB settings & batch
 * while keeping T-1 / T-2 reusable (no exact calendar dates).
 */
async function getT1T2Metadata(batchId) {
  let institution = 'Technical Training Centre – Akuressa';
  let trade = 'ICT Technician (NVQ Level 4)';
  let instructor = 'K.A.R.Lakshan';
  let traineesCount = 25;
  let batchName = '';

  try {
    const [settingsRows] = await db.query('SELECT k, v FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.k] = r.v; });
    if (settings.institute_name) institution = settings.institute_name;
    if (settings.teacher_name) instructor = settings.teacher_name;

    if (batchId) {
      const [bRows] = await db.query('SELECT id, name FROM batches WHERE id = ?', [batchId]);
      if (bRows.length) batchName = bRows[0].name;
      const [sRows] = await db.query(
        "SELECT COUNT(*) AS cnt FROM students WHERE batch_id = ? AND (status = 'active' OR active = 1)",
        [batchId]
      ).catch(() => db.query('SELECT COUNT(*) AS cnt FROM students WHERE batch_id = ?', [batchId]));
      if (sRows && sRows[0] && Number(sRows[0].cnt) > 0) {
        traineesCount = Number(sRows[0].cnt);
      }
    }
  } catch (err) {
    // Fallback to defaults if offline
  }

  return {
    institution,
    trade,
    instructor,
    traineesCount,
    batchName
  };
}

/**
 * Get the enriched list of 12 Core Modules (M01 - M12) with computed T-2 time splits.
 */
function getCoreT1T2Modules(selectedCodes = null) {
  let list = TVEC_CORE_MODULES;
  if (Array.isArray(selectedCodes) && selectedCodes.length > 0) {
    const codeSet = new Set(selectedCodes.map(c => String(c).trim().toUpperCase()));
    list = list.filter(m => codeSet.has(m.code.toUpperCase()));
  }
  return list.map(m => ({
    ...m,
    tasksCount: m.tasks.length,
    sessionsTotal: m.tasks.reduce((a, t) => a + t.sessions, 0),
    minutesTotal: m.tasks.reduce((a, t) => a + (t.minutes || t.sessions * 180), 0),
    tasks: m.tasks.map(t => {
      const mins = t.minutes || t.sessions * 180;
      const hrs = Math.round((mins / 60) * 100) / 100;
      return {
        ...t,
        hours: hrs,
        hoursFormatted: fmtHrs(hrs),
        timeSplit: splitT2Minutes(mins),
        hourSplit: splitT2Hours(mins)
      };
    })
  }));
}

module.exports = {
  TVEC_CORE_MODULES,
  fmtHrs,
  splitT2Hours,
  splitT2Minutes,
  getCoreT1T2Modules,
  getT1T2Metadata,
  generateModuleXlsxBuffer
};
