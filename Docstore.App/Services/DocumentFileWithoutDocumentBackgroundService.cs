using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.App.Services
{
    public class DocumentFileWithoutDocumentBackgroundService : BackgroundService
    {
        private readonly ILogger<DocumentFileWithoutDocumentBackgroundService> _logger;
        private readonly IWebHostEnvironment _hostingEnvironment;
        private readonly IServiceScopeFactory _serviceScopeFactory;
        public DocumentFileWithoutDocumentBackgroundService(ILogger<DocumentFileWithoutDocumentBackgroundService> logger, IServiceScopeFactory serviceScopeFactory, IWebHostEnvironment hostingEnvironment)
        {
            _logger = logger;
            _serviceScopeFactory = serviceScopeFactory;
            _hostingEnvironment = hostingEnvironment;
        }

        protected async override Task ExecuteAsync(CancellationToken stoppingToken)
        {

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _serviceScopeFactory.CreateScope();
                    var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

                    // get all documentFile without docuemnt and have been created at least 4 hours ago
                    var documentFiles = await context.DocumentFiles
                        .Where(d => d.DocumentId == null)
                        .Where(d => d.CreatedAt < DateTime.UtcNow.AddHours(-3))
                        .ToListAsync(cancellationToken: stoppingToken);

                    if (documentFiles.Any())
                    {
                        context.DocumentFiles.RemoveRange(documentFiles);
                        await context.SaveChangesAsync(cancellationToken: stoppingToken);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"{nameof(DocumentFileWithoutDocumentBackgroundService)} : {nameof(ExecuteAsync)}");
                }

                var delay = TimeSpan.FromHours(12);
                await Task.Delay((int)delay.TotalMilliseconds, stoppingToken);
            }
        }
    }
}
