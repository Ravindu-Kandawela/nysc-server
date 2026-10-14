'use strict';
/**
 * Lesson plan content for NCS K72S004 — ICT Technician NVQ Level 4.
 * Source: "Lesson Plan NVQ 4.pdf" (Technical Training Centre).
 * Keyed by module code. Session hours are auto-split from module hours when `hours` is omitted.
 * Note: the PDF's "Develop basic software solution (132h)" = M09 (48h) + M12 (84h).
 */
module.exports = {
  M01: {
    unit_title: 'Use the computer and manage files within standard operating systems',
    goal: 'To equip learners with the skills to configure computers, manage file systems, and maintain system security.',
    resources: [
      'Computers with Windows or Linux OS',
      'External storage (USB drives) for backup practice',
      'Sample files for searching/compression exercises',
      'Standard antivirus software'
    ],
    assessment: [
      'Final Practical: Powering on -> Configuring a setting -> Creating/Saving a file -> Compressing it -> Scanning for viruses -> Proper shutdown'
    ],
    sessions: [
      {
        title: 'Fundamentals & Configuration', focus: 'Elements 1 & 2',
        topics: [
          'Startup & Shutdown: "Protected Power Supply" (UPS/Surge protector) sequence',
          'Properly terminating applications before shutdown',
          'Handling non-responsive apps (Task Manager/Force Quit)',
          'Identifying system versions (About this PC)',
          'Personalizing the desktop: date, time, colour settings and display resolution'
        ],
        activity: 'Students change their keyboard language and install a new font according to specific instructions.'
      },
      {
        title: 'System Maintenance & Environment', focus: 'Elements 3, 5 & 6',
        topics: [
          'Checking for disk errors and managing local storage',
          'The "Recycle Bin" workflow: deletion vs. permanent removal',
          'Importance of regular backups',
          'Creating shortcuts and menu icons',
          'Advanced window handling: tiling, cascading and split screens for multitasking'
        ],
        activity: 'A "clean-up" race: organise desktop icons, clear storage, and arrange three open windows in a split-view.'
      },
      {
        title: 'Mastering the File System', focus: 'Elements 4 & 7',
        topics: [
          'Text editing: creating, naming and saving files in specific directory paths',
          'Hierarchical structure (Drives > Folders > Sub-folders)',
          'Changing file attributes (Hidden, Read-only, Archive)',
          'Using wildcards (e.g. *.docx) to search for file types',
          'Compression: using zip tools to archive and extract data'
        ],
        activity: 'A "File Scavenger Hunt": find specific files by date modified and compress them into a single folder.'
      },
      {
        title: 'Security & Final Assessment', focus: 'Element 8 + Review',
        topics: [
          'Updating virus definitions',
          'Running custom scans on specific drives or external folders',
          'Applying standard security settings',
          'Installation and uninstallation of software (Element 2.5)',
          'Using Help functions to troubleshoot minor issues'
        ],
        activity: 'Comprehensive practical test covering the full lifecycle from power on to proper shutdown.'
      }
    ]
  },

  M02: {
    unit_title: 'Perform word processing',
    goal: 'To enable learners to create professional documents, automate tasks with mail merge, and manage complex layouts and data tables.',
    resources: ['Computers with a word processing application', 'Template documents', 'Sample data source for mail merge', 'Printer / PDF printer'],
    assessment: ['Produce a 3-page "Technical Report" with a TOC, a table with a formula, an image, and no spelling errors'],
    sessions: [
      {
        title: 'Application Setup & Text Operations', focus: 'Elements 1, 2 & 3',
        topics: [
          'Opening documents from templates, saving with passwords, using Help',
          'Modifying toolbars/rulers, setting up Auto-save and language preferences',
          'Inserting special characters and symbols, using Find & Replace'
        ],
        activity: 'Set up a document with a 5-minute Auto-save, type a paragraph with symbols (© €), and use Find/Replace to update a recurring word.'
      },
      {
        title: 'Professional Formatting & Styling', focus: 'Elements 4 & 5',
        topics: [
          'Paragraph mastery: line spacing, first-line indents and tab stops',
          'Layout design: orientation, margins and section breaks',
          'Headers, footers and automatic page numbering',
          'Defining and applying global styles for consistency'
        ],
        activity: 'Create a two-column newsletter with a dated header and a page-numbered footer.'
      },
      {
        title: 'Tables, Objects & OLE', focus: 'Elements 6 & 7',
        topics: [
          'Advanced tables: merging/splitting cells, text direction, sorting data',
          'Basic formulas within a table (e.g. summing a column)',
          'Inserting charts, images and Word Art',
          'OLE: linking an external chart or data object'
        ],
        activity: 'Create an invoice table with a formula total and a "Paid" Word Art watermark.'
      },
      {
        title: 'Mail Merge & Document Review', focus: 'Elements 8 & 9',
        topics: [
          'Preparing a mailing list (data source) and merging into a form letter',
          'Track Changes, comments, accepting/rejecting markups'
        ],
        activity: 'Mail merge personalised invitation letters for 5 recipients from a single data file.'
      },
      {
        title: 'Final Review, Table of Contents & Printing', focus: 'Elements 10 & 11',
        topics: [
          'Automatic Table of Contents and Table of Figures',
          'Spell-check, custom dictionaries and print preview',
          'Printing specific sections, collating copies, saving as PDF/other formats'
        ],
        activity: 'Assessment: 3-page Technical Report with TOC, formula table, image and no spelling errors.'
      }
    ]
  },

  M03: {
    unit_title: 'Prepare spreadsheets',
    goal: 'To equip learners with the ability to manage workbooks, use complex formulas, visualize data through charts, and prepare professional reports for printing.',
    resources: ['Computers with spreadsheet software', 'Sample datasets (grades, budgets, price lists)', 'Printer / PDF printer'],
    assessment: ['Prepare a complete 3-page report, check for calculation errors, set Landscape orientation and export as PDF'],
    sessions: [
      {
        title: 'Interface & Workbook Management', focus: 'Elements 1, 2 & 3',
        topics: [
          'Navigating, renaming, moving and protecting worksheets',
          'Zoom, freeze panes, hiding/unhiding rows and columns',
          'Selecting adjacent and non-adjacent ranges; inserting/deleting rows and columns'
        ],
        activity: 'Create a multi-sheet workbook with a "Summary" sheet and "Monthly Data" sheets with frozen headers.'
      },
      {
        title: 'Data Entry & Cell Formatting', focus: 'Elements 4, 5 & 6',
        topics: [
          'Importing data from other formats and basic data entry',
          'Cell types (Currency, Percentage, Date), text wrapping, orientation',
          'Auto Fill handle and Transpose pasting'
        ],
        activity: 'Design a price list with Currency formatting (Rs.) and wrapped item descriptions.'
      },
      {
        title: 'Data Organization & Search', focus: 'Elements 7 & 8',
        topics: [
          'Finding specific values and bulk-replacing them',
          'Sorting and filtering lists',
          'Conditional formatting rules'
        ],
        activity: 'Highlight marks below 40 in red with conditional formatting and sort highest to lowest.'
      },
      {
        title: 'Arithmetic & Logical Functions', focus: 'Element 9',
        topics: [
          'Relative vs. absolute cell referencing ($)',
          'SUM, AVERAGE, MIN, MAX and COUNT',
          'IF statements for decision-making'
        ],
        activity: 'Budget sheet with totals, averages and an IF function flagging "Over Budget".'
      },
      {
        title: 'Data Visualization (Charts & Graphs)', focus: 'Element 10',
        topics: [
          'Column, Bar, Line and Pie charts',
          'Titles, labels, legends, colours and background styles',
          'Moving and resizing charts within/between worksheets'
        ],
        activity: 'Convert a "Monthly Expenses" table into a Pie chart showing percentage spend per category.'
      },
      {
        title: 'Final Setup, Printing & Exporting', focus: 'Elements 11, 12 & 13',
        topics: [
          'Margins, orientation, headers/footers and Page Fit',
          'Gridlines, headings and Print Titles',
          'Saving in different formats (PDF, CSV, etc.)'
        ],
        activity: 'Final practical: 3-page landscape report exported as PDF.'
      }
    ]
  },

  M04: {
    unit_title: 'Prepare presentation resources',
    goal: 'To enable learners to create, format, and animate professional presentations while adhering to health and safety standards for output devices.',
    resources: ['Computers with presentation software', 'Multimedia projector', 'Sample images, logos and charts'],
    assessment: ['Photo Gallery deck with 10-second automatic transitions exported as a PDF handout'],
    sessions: [
      {
        title: 'Application Basics & Slide Management', focus: 'Elements 1, 2, 3 & 4',
        topics: [
          'Opening/closing the app, templates, saving under different names/locations',
          'Zoom, ribbons/toolbars, display settings for projector vs. monitor',
          'Normal, Slide Sorter and Outline views',
          'Adding, deleting, hiding and rearranging slides'
        ],
        activity: 'Create a 5-slide "Workplace Safety" presentation and reorder slides to change the flow.'
      },
      {
        title: 'Design Consistency & Master Slides', focus: 'Elements 5 & 6',
        topics: [
          'Selecting and modifying design templates',
          'Slide Masters for slide numbers, dates and recurring logos'
        ],
        activity: 'Set up a Slide Master with a logo top-right and a slide number in every footer.'
      },
      {
        title: 'Content Formatting & SmartArt', focus: 'Elements 7, 9 & 10',
        topics: [
          'Character attributes, paragraph alignment and bullet spacing',
          'Presenter notes',
          'Inserting and modifying SmartArt'
        ],
        activity: 'Create a "Company Hierarchy" SmartArt chart legible from a distance.'
      },
      {
        title: 'Multimedia, Drawing & Interactivity', focus: 'Elements 8, 11 & 12',
        topics: [
          'Inserting, resizing and editing images, charts and objects',
          'Custom shapes, grouping and ordering drawing objects',
          'Hyperlinks and Action Buttons'
        ],
        activity: 'Insert an image and chart, then add a "Home" action button linking to slide 1.'
      },
      {
        title: 'Animation, Transitions & Final Delivery', focus: 'Elements 13 & 14',
        topics: [
          'Custom animations and slide transitions',
          'Advanced timing for automatic progression',
          'Recording, Custom Slide Shows and delivery practice',
          'Exporting as PDF, video or handouts'
        ],
        activity: 'Set 10-second auto transitions on a Photo Gallery deck and export as a PDF handout.'
      }
    ]
  },

  M05: {
    unit_title: 'Perform basic operations of cloud computing including internet and email services',
    goal: 'To provide learners with the skills to navigate the internet safely, manage professional communications via email, and leverage cloud-based tools for collaborative work.',
    resources: ['Internet-connected computers', 'Email accounts', 'Cloud storage / collaboration accounts (e.g. Google Workspace)', 'Video conferencing tool'],
    assessment: ['Find a data set online, summarise it in a shared cloud document and email the link with appropriate permissions'],
    sessions: [
      {
        title: 'Web Navigation & Advanced Search', focus: 'Element 1',
        topics: [
          'Customising home pages, bookmarks/favourites and navigation',
          'Search engines including AI-based search for documents, audio and video',
          'Saving pages offline; clearing temporary files and history'
        ],
        activity: 'Search for a technical document, bookmark it, save offline and clear the browser cache.'
      },
      {
        title: 'Professional Email Services', focus: 'Element 2',
        topics: [
          'Signing up and signing in to email accounts',
          'Using CC and BCC correctly',
          'Sending and receiving attachments safely'
        ],
        activity: 'Draft a professional email to a "manager" with a "client" in CC and an attached report.'
      },
      {
        title: 'Social Media & Video Conferencing', focus: 'Elements 3 & 5',
        topics: [
          'Social media best practices; creating/managing a YouTube channel',
          'Scheduling and hosting video conferences with host permissions',
          'Ethics and organisational procedures during recordings and meetings'
        ],
        activity: 'Schedule a mock meeting with "Mute on Entry" and demonstrate starting a recording.'
      },
      {
        title: 'Collaborative Cloud Applications', focus: 'Element 4',
        topics: [
          'Creating documents and spreadsheets for collaborative editing',
          'Viewer, Commenter and Editor permissions',
          'Cloud forms for surveys and data collection'
        ],
        activity: 'Share a spreadsheet with "Commenter" access and track suggested changes.'
      },
      {
        title: 'Cloud Storage & Syncing', focus: 'Element 6',
        topics: [
          'Uploading documents according to SOP',
          'Backup and restore facilities',
          'Automatic syncing between local folders and cloud'
        ],
        activity: 'Upload and share a folder, then enable offline sync on a local machine.'
      },
      {
        title: 'Final Integration & Digital Safety', focus: 'Review',
        topics: [
          'Integrating searching, emailing and cloud storage',
          'Reviewing password security and shared link permissions'
        ],
        activity: 'Assessment: data set -> shared cloud summary -> emailed link with correct permissions.'
      }
    ]
  },

  M06: {
    unit_title: 'Handle relational database',
    goal: 'To enable learners to design, create, and manipulate relational databases, including building relationships, running queries, and generating professional reports.',
    resources: ['Computers with a desktop DBMS (e.g. MS Access / LibreOffice Base)', 'Sample student/course data files'],
    assessment: ['Generate an "Enrollment Report" grouped by course with a total count'],
    sessions: [
      {
        title: 'Database Foundations & Table Creation', focus: 'Elements 1 & 2',
        topics: [
          'Opening/closing the database application, creating blank databases',
          'Field names, data types (Text, Number, Date/Time) and attributes',
          'Validation rules'
        ],
        activity: 'Create a "Student_Info" table with Name, Date of Birth and Gender using correct data types.'
      },
      {
        title: 'Keys & Relationships', focus: 'Element 3',
        topics: [
          'Defining Primary Keys',
          'Indexes with or without duplicates',
          'Building relationships between tables'
        ],
        activity: 'Create "Course_Enrolment" and link it to "Student_Info" with a shared ID.'
      },
      {
        title: 'Data Manipulation & Forms', focus: 'Element 4',
        topics: [
          'Adding, modifying and deleting records in Datasheet view',
          'Data entry forms using single or multiple tables',
          'Importing and exporting data'
        ],
        activity: 'Build a data entry form for "Student_Info" and add five records.'
      },
      {
        title: 'Queries & Data Analysis', focus: 'Element 5',
        topics: [
          'Queries using single or multiple tables with criteria',
          'Aggregate functions: SUM, AVG, COUNT, MAX, MIN',
          'Modifying existing queries'
        ],
        activity: 'Run a query that COUNTs students enrolled in a specific course.'
      },
      {
        title: 'Reporting & Professional Output', focus: 'Elements 6 & 7',
        topics: [
          'Creating reports from tables or queries',
          'Arranging fields, headings and grouping',
          'Headers/footers and aggregated totals',
          'Previewing and printing tables, forms and query results'
        ],
        activity: 'Generate an "Enrollment Report" grouped by course with a total count.'
      }
    ]
  },

  M07: {
    unit_title: 'Conduct routine maintenance services of computer system and peripherals',
    goal: 'To equip learners with the skills to set up hardware, manage software environments, rectify system faults, and perform preventative maintenance according to SOPs.',
    resources: ['Lab computers and spare parts', 'Printer, router, switch, UPS', 'OS installation media', 'Antivirus and maintenance tools', 'External drives'],
    assessment: [
      'Client Workstation task: identify peripherals, update OS and drivers, clean up and scan, back up data',
      'Submit a final Maintenance Report in accordance with the SOP'
    ],
    sessions: [
      {
        title: 'Hardware Identification & Network Setup', focus: 'Element 1 (Setup & Configuration)',
        topics: [
          'Input/output devices and power management tools (UPS, surge protectors)',
          'Network devices (routers, switches, LAN cables)',
          'Following manufacturer guidelines for installation'
        ],
        activity: '"Peripheral Scavenger Hunt": identify, connect and verify a printer, router and UPS.'
      },
      {
        title: 'Operating Systems & Software Management', focus: 'Element 2 (PC 2.1 – 2.3)',
        topics: [
          'Installing, configuring and uninstalling operating systems',
          'Installing and configuring productivity and utility software',
          'Updates and patches'
        ],
        activity: 'Clean-install an OS and a standard software suite.'
      },
      {
        title: 'Driver Management & Fault Rectification', focus: 'Element 2 (PC 2.4 – 2.5)',
        topics: [
          'Identifying missing/outdated drivers with Device Manager',
          'Diagnosing RAM, hard drive and power supply failures',
          'Escalation SOPs'
        ],
        activity: '"Fault Lab": identify, correct and document 3 introduced faults.'
      },
      {
        title: 'Preventative Maintenance & Security', focus: 'Element 3 (PC 3.1 – 3.3)',
        topics: [
          'Installing, configuring and scheduling antivirus scans',
          'Disk Cleanup and defragmentation',
          'Virus cleaning procedures'
        ],
        activity: '"System Health Check": full scan, clear temp files, defragment a non-SSD drive.'
      },
      {
        title: 'Backups, Reporting & Documentation', focus: 'Element 3 (PC 3.4 – 3.6)',
        topics: [
          'Backup and restore procedures',
          'Communicating technical issues to authorised officers',
          'Maintenance logs'
        ],
        activity: 'Create a restore point, back up user data and complete a Maintenance Log Entry.'
      }
    ]
  },

  M08: {
    unit_title: 'Produce print page layout and multimedia objects',
    goal: 'To enable learners to create, manipulate, and save graphical objects using industry-standard tools and techniques.',
    resources: ['Computers with graphics software (e.g. Photoshop / Illustrator / GIMP / Inkscape)', 'Sample photos and logos'],
    assessment: ['Import a photo, add a semi-transparent text overlay, and export a high-quality PDF'],
    sessions: [
      {
        title: 'Graphics Fundamentals & Environment', focus: 'Elements 1 & 2',
        topics: [
          'Navigating toolbars, palettes and canvas',
          'RGB vs. CMYK colour',
          'Vector vs. raster; JPEG, PNG, SVG, AI, PSD'
        ],
        activity: 'Set up a 300 DPI document and switch colour modes to compare appearance.'
      },
      {
        title: 'Creating & Transforming Objects', focus: 'Element 3',
        topics: [
          'Rectangles, ellipses, polygons and stars with dimensions',
          'Move, resize, rotate and skew',
          'Fill, stroke and gradients'
        ],
        activity: 'Create a corporate logo with three shapes and a two-colour gradient.'
      },
      {
        title: 'Advanced Composition & Layering', focus: 'Element 4',
        topics: [
          'Creating, naming, locking and hiding layers',
          'Bring to Front / Send to Back',
          'Pen tool and Type tool'
        ],
        activity: 'Design a business card with background, logo and text on separate labelled layers.'
      },
      {
        title: 'Image Editing & Exporting', focus: 'Elements 5 & 6',
        topics: [
          'Importing existing images',
          'Cropping, scaling and opacity',
          'Saving master files and exporting flattened JPEG/PDF'
        ],
        activity: 'Photo + background + semi-transparent text overlay exported as a high-quality PDF.'
      }
    ]
  },

  M09: {
    unit_title: 'Develop basic software solution (Analysis & Design)',
    goal: 'To enable learners to identify customer needs, formalise them into an SRS, and translate them into visual designs and test plans.',
    resources: ['Case study scenarios (e.g. Library Management System)', 'Diagramming tools (draw.io / Visio)'],
    assessment: ['Portfolio review: SRS, DFDs and Test Plans against performance criteria', 'Q&A: importance of the feasibility study'],
    sessions: [
      {
        title: 'Requirements Gathering & Analysis', focus: 'Element 1 — SRS',
        topics: [
          'Interviews, questionnaires, observation and document review',
          'Feasibility study: technical, economic and operational (SOP)',
          'Writing functional and non-functional requirements'
        ],
        activity: 'Case study: mock interview to gather requirements; produce a draft SRS for approval.'
      },
      {
        title: 'System Design & Logic Modeling', focus: 'Element 2 — Design',
        topics: [
          'Data Flow Diagrams (Levels 0, 1 and 2)',
          'Flowcharts and pseudocode',
          'UML Use Case and Class diagrams',
          'Test planning'
        ],
        activity: 'Mapping workshop: DFD Level 0 and pseudocode for "User Login" from the SRS.'
      }
    ]
  },

  M12: {
    unit_title: 'Develop basic software solution (Implementation)',
    goal: 'To execute the design and ensure the final product meets the initial specifications.',
    resources: ['Computers with an IDE and programming language', 'Database server', 'Design package from M09'],
    assessment: ['Practical project: complete a mini-information system from start to finish', 'Peer User Acceptance Testing'],
    sessions: [
      {
        title: 'Implementation, Testing & Documentation', focus: 'Implement information system & desktop applications',
        topics: [
          'Selecting a programming language and connecting the front-end to a database',
          'Executing the test plan to find and fix bugs',
          'Preparing technical manuals and user guides according to SOP'
        ],
        activity: 'Build & test a module, then swap with a peer for User Acceptance Testing.'
      }
    ]
  },

  M10: {
    unit_title: 'Handle relational databases using standard SQL',
    goal: 'To enable learners to install a DBMS, define and manipulate data with SQL, and produce reports using queries and views.',
    resources: ['Computers with MySQL / SQL Server', 'Sample "Retail Store" scripts'],
    assessment: [
      'Practical lab exam: specific SQL tasks',
      'Portfolio review of SQL scripts and diagrams',
      'Oral questioning: primary vs. foreign keys, aggregate functions'
    ],
    sessions: [
      {
        title: 'DBMS Setup and Data Definition (DDL)', focus: 'Elements 1 & 2',
        topics: [
          'Installing a DBMS and logging in per SOP',
          'CREATE DATABASE and CREATE TABLE',
          'Data types, field sizes and constraints',
          'Primary and foreign keys',
          'ALTER, DROP and RENAME'
        ],
        activity: 'Create a "Retail Store" database with Products, Categories and Suppliers.'
      },
      {
        title: 'Data Manipulation & Maintenance (DML)', focus: 'Element 3',
        topics: [
          'INSERT, UPDATE and DELETE',
          'Importing and exporting data and structures',
          'Backup and restore',
          'SOPs for safely deleting databases and tables'
        ],
        activity: 'Insert 10–15 records and practise a full backup/restore cycle.'
      },
      {
        title: 'Data Retrieval & Advanced Queries (DQL)', focus: 'Element 4',
        topics: [
          'SELECT, FROM and WHERE with conditions',
          'INNER, LEFT and RIGHT joins',
          'SUM(), AVG(), COUNT(), MIN(), MAX()'
        ],
        activity: 'Queries for Total Stock Value, Average Product Price and Products by Category.'
      },
      {
        title: 'Manipulating Views & Optimization', focus: 'Element 5',
        topics: [
          'CREATE VIEW',
          'Modifying and deleting views',
          'Review of the database lifecycle'
        ],
        activity: 'Create a view joining Products and Suppliers.'
      }
    ]
  },

  M11: {
    unit_title: 'Design static website',
    goal: 'To translate customer requirements into a professional static website using HTML and CSS.',
    resources: ['Computers with a code editor and browser', 'Client brief (e.g. local bakery)'],
    assessment: [
      'Project portfolio: finalised HTML and CSS files',
      'Performance criteria check: tags, linking and layout',
      'VIVA on design best practices'
    ],
    sessions: [
      {
        title: 'Planning & UI/UX Best Practices', focus: 'Element 1',
        topics: [
          'Identifying and documenting customer needs',
          'Layout and wireframing (header, navigation, content, footer)',
          'Mobile-first design, accessibility and typography'
        ],
        activity: 'Blueprint Challenge: wireframe a home page and a product page for a client brief.'
      },
      {
        title: 'Structuring Content with HTML', focus: 'Element 2',
        topics: [
          'Basic skeleton: DOCTYPE, html, head, body',
          'Semantic tags and text tags',
          'Images, lists and tables',
          'Hyperlinks; absolute vs. relative paths'
        ],
        activity: 'Code the wireframe into a multi-page HTML-only website.'
      },
      {
        title: 'Visual Enhancement with CSS', focus: 'Element 3',
        topics: [
          'Selectors, properties and values',
          'Inline, internal and external CSS',
          'Box model: colours, fonts, margins, padding, borders',
          'Basic media queries'
        ],
        activity: 'Style the website with an external CSS file matching the wireframe.'
      }
    ]
  },

  BM01: {
    unit_title: 'Practice workplace communication and interpersonal relations',
    goal: 'Develop effective interpersonal skills and accurate information handling within a professional environment.',
    resources: ['Workplace scenarios', 'Sample organisational forms'],
    assessment: ['Direct observation of courteous manner', 'Portfolio of completed forms', 'Written quiz on diversity situations'],
    sessions: [
      {
        title: 'Cooperation and Communication', focus: 'Elements 1.5 – 1.8',
        topics: ['Non-verbal communication: body language, eye contact, tone', 'Constructive feedback', 'Coordinating with different departments'],
        activity: '"The Idea Exchange": solve a shifting-deadline scenario and document how ideas were shared.'
      },
      {
        title: 'Diversity and Inclusion', focus: 'Elements 2.1 – 2.2',
        topics: ['Unconscious bias', 'Cultural intelligence'],
        activity: '"Perspective Walk": discuss cultural norms in professional settings.'
      },
      {
        title: 'Information Gathering and Flow', focus: 'Elements 3.1 – 3.5',
        topics: ['Active listening: paraphrasing and questioning', 'Obtaining approved work instructions'],
        activity: '"The Clear Message Challenge": convey and record complex instructions verbally.'
      },
      {
        title: 'Workplace Documentation', focus: 'Elements 4.1 – 4.3',
        topics: ['Identifying the right form for each task', 'Accuracy and timelines in reporting'],
        activity: '"The Report Audit": complete a workplace form within 5 minutes.'
      }
    ]
  },

  BM02: {
    unit_title: 'Apply occupational literacy and numeracy',
    goal: 'To apply basic mathematics and written communication skills to solve workplace problems and convey technical information accurately.',
    resources: ['Calculators', 'Technical manuals and MSDS samples', 'Measuring tools'],
    assessment: ['Math competency test', 'Writing assessment with accurate units and codes', 'Observation of calculator/manual tool use'],
    sessions: [
      {
        title: 'Workplace Mathematics & Problem Solving', focus: 'Elements 1.1 – 1.4',
        topics: ['Whole numbers, fractions, decimals and percentages', 'Basic geometry and measurement', 'Applied ratios'],
        activity: '"The Precision Cut": calculate lengths from ratios and waste percentages.'
      },
      {
        title: 'Written Communication of Ideas', focus: 'Elements 2.1 – 2.3',
        topics: ['Technical vocabulary', 'Clear, concise notes and emails', 'Metric units and technical symbols'],
        activity: '"The Shift Log": handover report with five technical terms and three units.'
      },
      {
        title: 'Reading and Interpreting Materials', focus: 'Elements 3.1 – 3.3',
        topics: ['Safety signs, manuals and MSDS', 'Codes and symbols in technical drawings', 'Turning written instructions into actions'],
        activity: '"The Manual Audit": explain the sequence of steps in a technical manual.'
      }
    ]
  },

  BM03: {
    unit_title: 'Work in a team',
    goal: 'To identify team roles, contribute effectively to group objectives, and maintain harmonious professional relationships while ensuring safety.',
    resources: ['Team scenarios', 'Role cards'],
    assessment: ['Peer evaluation', 'Role identification test', 'Safety observation'],
    sessions: [
      {
        title: 'Understanding Team Roles and Scope', focus: 'Elements 1.1 – 1.2',
        topics: ['Formal vs. informal teams', 'The "Goal-Role" link'],
        activity: '"The Machine Analogy": visualise team interdependency.'
      },
      {
        title: 'Active Participation and Communication', focus: 'Elements 2.1 – 2.5',
        topics: ['Communication styles', 'Collective decision-making', 'Team safety'],
        activity: '"The Consensus Challenge": reach a group decision respecting a minority viewpoint.'
      },
      {
        title: 'Maintaining Productive Relations', focus: 'Elements 3.1 – 3.3',
        topics: ['Role clarity', 'Conflict prevention'],
        activity: '"The Role Swap Roleplay": handle a missed deadline without blame.'
      }
    ]
  },

  BM04: {
    unit_title: 'Practice occupational health and safety measures',
    goal: 'To identify workplace hazards, follow safety protocols, and communicate effectively during routine tasks and emergencies.',
    resources: ['PPE samples', 'First aid kit', 'Fire safety equipment', 'Incident report forms'],
    assessment: ['Practical demonstration of PPE and manual handling', 'Documentation audit of an incident report', 'Verbal "Toolbox Talk"'],
    sessions: [
      {
        title: 'Foundations of Workplace Safety', focus: 'Elements A 1.1 – 1.6 & 1.8',
        topics: ['Hazard identification', 'Manual handling', 'PPE selection'],
        activity: '"The Hazard Hunt": identify and report 5 risks in a simulated workshop.'
      },
      {
        title: 'Effective Communication & Documentation', focus: 'Elements 1.6, 3.1 – 3.5 & 4.1 – 4.3',
        topics: ['Active listening for approved instructions', 'Information transfer without distortion', 'Record keeping and safety checklists'],
        activity: '"The Instruction Chain": simplify a technical instruction preserving units and safety codes.'
      },
      {
        title: 'Diversity and Team Cooperation', focus: 'Elements 1.5, 1.7 & 2.1 – 2.2',
        topics: ['Inclusion', 'Professional courtesy under pressure'],
        activity: '"The Perspective Panel": group discussion on cultural communication.'
      },
      {
        title: 'Emergency Procedures & First Aid', focus: 'Elements A 1.9 & B 2.1 – 2.6',
        topics: ['Fire safety and evacuation', 'Basic first aid', 'Emergency contacts', 'Accident documentation'],
        activity: '"Simulation: Red Alert": alarm, exit, contact supervisor, document the event.'
      }
    ]
  }
};
