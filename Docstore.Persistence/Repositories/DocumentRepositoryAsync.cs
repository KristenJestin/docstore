using Docstore.Application.Extensions;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.Persistence.Repositories
{
    public class DocumentRepositoryAsync : GenericRepositoryAsync<Document>, IDocumentRepositoryAsync
    {
        private readonly DbSet<Document> _documents;

        public DocumentRepositoryAsync(AppDbContext db) : base(db)
        {
            _documents = db.Set<Document>();
        }

        public async Task<PagedResult<Document>> GetPagedReponseAsync(int user, int pageNumber, int pageSize, string? search = null, int? tag = null)
        {
            IQueryable<Document> query = _documents;

            #region parameters
            if (!string.IsNullOrWhiteSpace(search))
                query = query.Where(d => d.Name!.Contains(search));

            if (tag != null)
                query = query
                    .Where(d => d.Tags.Any(t => t.Id == tag.Value));
            #endregion

            // total
            var count = await query.CountAsync();
            // paginations
            query = query
                .Paginate(pageNumber, pageSize)
                .OrderByDescending(d => d.UpdatedAt)
                .AsNoTracking();

            // list documents
            return new PagedResult<Document>(await query.ToListAsync(), count, pageNumber, pageSize);
        }

        public async Task<Document?> FindByIdWithTypeAndTagsAndFileAsync(int id)
            => await _documents
                .Include(d => d.Tags)
                .Include(d => d.Files)
                .FirstOrDefaultAsync(d => d.Id == id);
    }
}
