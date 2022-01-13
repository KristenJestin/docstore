namespace Docstore.Application.Interfaces
{
    public interface IGenericRepositoryAsync<T> where T : class
    {
        Task<T?> FindByIdAsync(int id);
        Task<IReadOnlyList<T>> GetAllAsync();
        Task<T> AddAsync(T entity, bool save = false);
        Task UpdateAsync(T entity, bool save = false);
        Task DeleteAsync(T entity, bool save = false);
    }
}
