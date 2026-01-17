/* schema-builder.js - Simple Schema Generator */
(function (global) {

    // ==========================================
    // MODULE: Schema Templates & Builder
    // ==========================================
    const SchemaBuilder = {

        // Main Build Function
        build(type, context) {
            // Basic Scaffolding
            const base = {
                '@context': 'https://schema.org',
                '@type': type
            };

            // 1. Common Data Injection (Zero Hallucination - only what we know)
            if (context.url) base.url = context.url;
            if (context.title) base.name = context.title;
            if (context.metaDescription) base.description = context.metaDescription;

            // Image: Prefer OG Image if available
            if (context.og?.image) {
                base.image = {
                    '@type': 'ImageObject',
                    'url': context.og.image
                };
            }

            // Entities (Simplified helper, no robust extraction engine)
            const authorName = context.meta?.author || 'Author Name';
            const pubName = context.og?.site_name || 'Publisher Name';

            // 2. Type-Specific Templates
            switch (type) {
                case 'Article':
                case 'BlogPosting':
                case 'NewsArticle':
                    base.headline = context.headings?.h1 ? context.headings.h1[0] : (base.name || 'Article Headline');
                    base.author = { '@type': 'Person', name: authorName };
                    base.publisher = {
                        '@type': 'Organization',
                        name: pubName,
                        logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' }
                    };
                    base.datePublished = context.meta?.published_time || new Date().toISOString();
                    base.dateModified = new Date().toISOString();
                    break;

                case 'Product':
                    base.brand = { '@type': 'Brand', name: pubName };
                    base.sku = "SKU-12345";
                    base.mpn = "MPN-12345";
                    base.offers = {
                        "@type": "Offer",
                        "url": context.url || "https://example.com/product",
                        "priceCurrency": "USD",
                        "price": "99.99",
                        "priceValidUntil": "2025-12-31",
                        "itemCondition": "https://schema.org/NewCondition",
                        "availability": "https://schema.org/InStock"
                    };
                    base.aggregateRating = {
                        "@type": "AggregateRating",
                        "ratingValue": "4.5",
                        "reviewCount": "24"
                    };
                    break;

                case 'FAQPage':
                    // Try to grab questions from headers containing '?'
                    const qs = (context.headingText?.order || [])
                        .filter(h => h.text?.includes('?'))
                        .slice(0, 5);

                    if (qs.length > 0) {
                        base.mainEntity = qs.map(q => ({
                            '@type': 'Question',
                            name: q.text,
                            acceptedAnswer: { '@type': 'Answer', text: 'Answer goes here...' }
                        }));
                    } else {
                        base.mainEntity = [{
                            '@type': 'Question',
                            name: 'Frequently Asked Question?',
                            acceptedAnswer: { '@type': 'Answer', text: 'Answer to the question...' }
                        }];
                    }
                    break;

                case 'Recipe':
                    base.author = { '@type': 'Person', name: authorName };
                    base.prepTime = "PT20M";
                    base.cookTime = "PT30M";
                    base.totalTime = "PT50M";
                    base.recipeYield = "4 servings";
                    base.recipeCategory = "Dinner";
                    base.nutrition = {
                        "@type": "NutritionInformation",
                        "calories": "250 calories"
                    };
                    base.recipeIngredient = ["Ingredient 1", "2 tbsp Ingredient 2"];
                    base.recipeInstructions = [
                        { "@type": "HowToStep", "text": "First step..." },
                        { "@type": "HowToStep", "text": "Second step..." }
                    ];
                    break;

                case 'LocalBusiness':
                case 'Organization':
                    base.telephone = "+1-555-555-5555";
                    base.email = "info@example.com";
                    base.address = {
                        "@type": "PostalAddress",
                        "streetAddress": "123 Business Rd",
                        "addressLocality": "City",
                        "addressRegion": "State",
                        "postalCode": "12345",
                        "addressCountry": "US"
                    };
                    if (type === 'LocalBusiness') {
                        base.geo = {
                            "@type": "GeoCoordinates",
                            "latitude": "40.7128",
                            "longitude": "-74.0060"
                        };
                        base.openingHoursSpecification = [{
                            "@type": "OpeningHoursSpecification",
                            "dayOfWeek": ["Monday", "Friday"],
                            "opens": "09:00",
                            "closes": "17:00"
                        }];
                        base.priceRange = "$$";
                    }
                    break;

                case 'JobPosting':
                    base.title = "Job Title";
                    base.datePosted = new Date().toISOString();
                    base.validThrough = "2025-12-31";
                    base.employmentType = "FULL_TIME";
                    base.hiringOrganization = {
                        "@type": "Organization",
                        "name": pubName,
                        "sameAs": "https://example.com"
                    };
                    base.jobLocation = {
                        "@type": "Place",
                        "address": {
                            "@type": "PostalAddress",
                            "streetAddress": "123 Street",
                            "addressLocality": "City",
                            "addressRegion": "State",
                            "postalCode": "00000",
                            "addressCountry": "US"
                        }
                    };
                    base.baseSalary = {
                        "@type": "MonetaryAmount",
                        "currency": "USD",
                        "value": {
                            "@type": "QuantitativeValue",
                            "value": 50000,
                            "unitText": "YEAR"
                        }
                    };
                    break;

                case 'Course':
                    base.name = context.title || "Course Name";
                    base.description = context.metaDescription || "Course Description";
                    base.provider = {
                        "@type": "Organization",
                        "name": pubName,
                        "sameAs": "https://example.com"
                    };
                    base.hasCourseInstance = {
                        "@type": "CourseInstance",
                        "courseMode": "online",
                        "courseWorkload": "PT10H"
                    };
                    break;

                case 'Event':
                case 'Webinar':
                    base.startDate = new Date().toISOString();
                    base.endDate = new Date(Date.now() + 3600000).toISOString();
                    base.eventStatus = "https://schema.org/EventScheduled";
                    base.eventAttendanceMode = type === 'Webinar' ?
                        "https://schema.org/OnlineEventAttendanceMode" :
                        "https://schema.org/OfflineEventAttendanceMode";

                    base.location = {
                        "@type": "Place",
                        "name": "Event Venue",
                        "address": {
                            "@type": "PostalAddress",
                            "streetAddress": "123 Street",
                            "addressLocality": "City",
                            "postalCode": "00000",
                            "addressCountry": "US"
                        }
                    };
                    break;

                case 'BreadcrumbList':
                    const parts = (context.url || '').split('/').filter(p => p.includes('http') === false && p !== '');
                    base.itemListElement = parts.map((p, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        name: p.replace(/-/g, ' ').replace('.html', ''),
                        item: context.origin + '/' + parts.slice(0, i + 1).join('/')
                    }));
                    break;
            }

            return base;
        }
    };

    // ==========================================
    // MODULE: Schema Auditor (Read Only)
    // ==========================================
    const SchemaAuditor = {
        audit(existingItems) {
            if (!existingItems || existingItems.length === 0) return { status: 'Missing', count: 0, types: [] };
            return {
                status: 'Present',
                count: existingItems.length,
                types: existingItems.map(i => i['@type'])
            };
        }
    };

    // Export
    global.SchemaBuilder = SchemaBuilder;
    global.SchemaAuditor = SchemaAuditor;

})(window);
